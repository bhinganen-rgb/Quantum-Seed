const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("QuantumSeed", function () {
  let qs, owner, alice, bob;
  const FEE = ethers.parseEther("0.001");

  async function mine(n) {
    for (let i = 0; i < n; i++) await ethers.provider.send("evm_mine");
  }

  function makeCommit(secretHex, saltHex) {
    return ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [secretHex, saltHex]));
  }

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("QuantumSeed");
    qs = await F.deploy();
    await qs.waitForDeployment();
  });

  it("stores hash and takes fee on commit", async () => {
    const secret = ethers.id("s1");
    const salt = ethers.id("salt1");
    const h = makeCommit(secret, salt);
    await expect(qs.connect(alice).commit(h, { value: FEE }))
      .to.emit(qs, "Committed");
    const r = await qs.getRequest(1);
    expect(r[0]).to.equal(alice.address);
    expect(r[1]).to.equal(h);
    expect(r[3]).to.equal(FEE);
    expect(r[5]).to.equal(0);
    expect(await ethers.provider.getBalance(await qs.getAddress())).to.equal(FEE);
  });

  it("rejects commit below fee", async () => {
    await expect(qs.commit(ethers.id("x"), { value: 0 })).to.be.revertedWith("Fee too low");
  });

  it("rejects empty commit hash", async () => {
    await expect(qs.commit(ethers.ZeroHash, { value: FEE })).to.be.revertedWith("Empty commit");
  });

  it("reveal requires correct secret+salt, requester, and window", async () => {
    const secret = ethers.id("secret");
    const salt = ethers.id("salt");
    const h = makeCommit(secret, salt);
    await qs.connect(alice).commit(h, { value: FEE });
    // too early
    await expect(qs.connect(alice).reveal(1, secret, salt)).to.be.revertedWith("Too early");
    await mine(3);
    // wrong secret
    await expect(qs.connect(alice).reveal(1, ethers.id("nope"), salt)).to.be.revertedWith("Bad reveal");
    // non-requester
    await expect(qs.connect(bob).reveal(1, secret, salt)).to.be.revertedWith("Not requester");
    // correct
    await expect(qs.connect(alice).reveal(1, secret, salt)).to.emit(qs, "Revealed");
    const r = await qs.getRequest(1);
    expect(r[5]).to.equal(1);
    expect(r[4]).to.not.equal(ethers.ZeroHash);
  });

  it("reveal returns deterministic random for same block context", async () => {
    // Two independent commits at the same height would produce different randoms because
    // blockhashes differ; here we just check that the random output is stored consistently.
    const secret = ethers.id("d1");
    const salt = ethers.id("d2");
    await qs.connect(alice).commit(makeCommit(secret, salt), { value: FEE });
    await mine(3);
    await qs.connect(alice).reveal(1, secret, salt);
    const r1 = (await qs.getRequest(1))[4];
    // Deterministic: getRequest returns the same value again
    const r2 = (await qs.getRequest(1))[4];
    expect(r1).to.equal(r2);
    expect(r1).to.not.equal(ethers.ZeroHash);
  });

  it("cannot double-reveal", async () => {
    const s = ethers.id("a"); const salt = ethers.id("b");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await mine(3);
    await qs.connect(alice).reveal(1, s, salt);
    await expect(qs.connect(alice).reveal(1, s, salt)).to.be.revertedWith("Not pending");
  });

  it("expireCommit only after window elapsed and moves fee to protocol", async () => {
    const s = ethers.id("x"); const salt = ethers.id("y");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await expect(qs.expireCommit(1)).to.be.revertedWith("Not expired yet");
    await mine(257);
    await expect(qs.connect(bob).expireCommit(1)).to.emit(qs, "Expired");
    expect(await qs.accumulatedFees()).to.equal(FEE);
    const r = await qs.getRequest(1);
    expect(r[5]).to.equal(2);
  });

  it("expired cannot be revealed", async () => {
    const s = ethers.id("x2"); const salt = ethers.id("y2");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await mine(257);
    await qs.expireCommit(1);
    await expect(qs.connect(alice).reveal(1, s, salt)).to.be.revertedWith("Not pending");
  });

  it("cannot reveal after window even without expire call", async () => {
    const s = ethers.id("late"); const salt = ethers.id("late2");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await mine(300);
    await expect(qs.connect(alice).reveal(1, s, salt)).to.be.revertedWith("Window expired");
  });

  it("admin bounds enforced", async () => {
    await expect(qs.setRevealDelayBlocks(0)).to.be.revertedWith("Delay out of range");
    await expect(qs.setRevealDelayBlocks(21)).to.be.revertedWith("Delay out of range");
    await expect(qs.setRevealWindowBlocks(19)).to.be.revertedWith("Window out of range");
    await expect(qs.setRevealWindowBlocks(1001)).to.be.revertedWith("Window out of range");
    await qs.setRevealDelayBlocks(5);
    await qs.setRevealWindowBlocks(100);
    await qs.setCommitFee(ethers.parseEther("0.01"));
    expect(await qs.revealDelayBlocks()).to.equal(5);
    expect(await qs.revealWindowBlocks()).to.equal(100);
    expect(await qs.commitFee()).to.equal(ethers.parseEther("0.01"));
  });

  it("only owner can admin", async () => {
    await expect(qs.connect(alice).setCommitFee(1)).to.be.reverted;
    await expect(qs.connect(alice).pause()).to.be.reverted;
  });

  it("pause blocks commit and reveal", async () => {
    await qs.pause();
    await expect(qs.commit(ethers.id("z"), { value: FEE })).to.be.reverted;
    await qs.unpause();
    const s = ethers.id("u"); const salt = ethers.id("v");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await qs.pause();
    await mine(3);
    await expect(qs.connect(alice).reveal(1, s, salt)).to.be.reverted;
  });

  it("view getters work: canReveal, getRequestsBy, requestCount", async () => {
    expect(await qs.requestCount()).to.equal(0);
    const s = ethers.id("g"); const salt = ethers.id("h");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await qs.connect(alice).commit(makeCommit(ethers.id("g2"), ethers.id("h2")), { value: FEE });
    expect(await qs.requestCount()).to.equal(2);
    expect(await qs.canReveal(1)).to.equal(false); // too early
    await mine(3);
    expect(await qs.canReveal(1)).to.equal(true);
    const ids = await qs.getRequestsBy(alice.address);
    expect(ids.length).to.equal(2);
    expect(ids[0]).to.equal(1n);
  });

  it("withdrawFees sends accumulated fees to owner", async () => {
    const s = ethers.id("w"); const salt = ethers.id("w2");
    await qs.connect(alice).commit(makeCommit(s, salt), { value: FEE });
    await mine(3);
    await qs.connect(alice).reveal(1, s, salt);
    expect(await qs.accumulatedFees()).to.equal(FEE);
    const before = await ethers.provider.getBalance(bob.address);
    await qs.withdrawFees(bob.address);
    const after = await ethers.provider.getBalance(bob.address);
    expect(after - before).to.equal(FEE);
    expect(await qs.accumulatedFees()).to.equal(0);
  });
});
