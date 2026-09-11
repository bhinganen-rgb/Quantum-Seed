const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(signer.address);
  console.log("Deployer:", signer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "BOT");
  console.log("Network:", hre.network.name);

  const F = await hre.ethers.getContractFactory("QuantumSeed");
  const qs = await F.deploy();
  await qs.waitForDeployment();
  const addr = await qs.getAddress();

  console.log("QuantumSeed deployed at:", addr);
  console.log("Update CONTRACT_ADDRESS in frontend/index.html");
}

main().catch((e) => { console.error(e); process.exit(1); });
