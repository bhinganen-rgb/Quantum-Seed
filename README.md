# QuantumSeed

Commit-reveal verifiable RNG on BOT Chain.

## How it works

1. **Commit**: user submits `keccak256(secret || salt)` plus a small fee.
2. **Wait**: `revealDelayBlocks` (default 3) must pass so a future blockhash is baked in.
3. **Reveal**: within `revealWindowBlocks` (default 256), user submits `secret + salt`. Contract verifies the hash and derives:
   ```
   random = keccak256(secret, salt, blockhash(commitBlock + delay), blockhash(currentBlock - 1))
   ```
4. **Expire**: if the reveal window elapses, anyone can call `expireCommit`; the commit fee is retained as protocol revenue.

Because the secret is unknown until the reveal, no one can predict the output at commit time. Once revealed, all inputs are on-chain and the result is fully verifiable off-chain.

**Note.** This is standard commit-reveal randomness. Validators can still influence `blockhash` to a limited degree by selective inclusion. For high-stakes randomness, combine with a VRF.

## Setup

```bash
npm install
cp .env.example .env   # add PRIVATE_KEY
npx hardhat compile
npx hardhat test
```

## Deploy

```bash
npm run deploy:testnet   # BOT Chain testnet (chainId 968)
npm run deploy:mainnet   # BOT Chain mainnet (chainId 677)
```

Update `CONTRACT_ADDRESS` in `frontend/index.html`.

## Networks

| Network | Chain ID | RPC |
|---|---|---|
| Testnet | 968 (0x3C8) | https://rpc.bohr.life |
| Mainnet | 677 (0x2A5) | https://rpc.botchain.ai |
