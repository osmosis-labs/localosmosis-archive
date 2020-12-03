import { randomBytes } from 'crypto';
import {
  Coins,
  OracleParams,
  BlockInfo,
  LCDClient,
  MnemonicKey,
  MsgAggregateExchangeRateVote,
} from "@terra-money/terra.js";

const {
  MAINNET_LCD_URL = "https://lcd.terra.dev",
  MAINNET_CHAIN_ID = "columbus-3",
  TESTNET_LCD_URL = "http://localhost:1317",
  TESTNET_CHAIN_ID = "localterra",
  MNEMONIC = "satisfy adjust timber high purchase tuition stool faith fine install that you unaware feed domain license impose boss human eager hat rent enjoy dawn",
} = process.env;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFirstBlock(client: LCDClient) {
  let shouldTerminate = false;

  console.info("waiting for first block");

  while (!shouldTerminate) {
    shouldTerminate = await client.tendermint
      .blockInfo()
      .then(async (blockInfo) => {
        await delay(5000);

        if (blockInfo?.block) {
          return +blockInfo.block?.header.height > 0;
        }

        return false;
      })
      .catch(async (err) => {
        console.error(err);
        await delay(1000);
        return false;
      });

    if (shouldTerminate) {
      break;
    }
  }
}

// config
const mainnetClient = new LCDClient({
  URL: MAINNET_LCD_URL,
  chainID: MAINNET_CHAIN_ID,
});

const testnetClient = new LCDClient({
  URL: TESTNET_LCD_URL,
  chainID: TESTNET_CHAIN_ID,
  gasPrices: "0.15uluna",
  gasAdjustment: 1.4,
});

const mk = new MnemonicKey({
  mnemonic: MNEMONIC,
});

const wallet = testnetClient.wallet(mk);

async function main() {
  let lastSuccessVotePeriod: number;
  let lastSuccessVoteMsg: MsgAggregateExchangeRateVote;

    const [rates, oracleParams, latestBlock] = await Promise.all([
      mainnetClient.oracle.exchangeRates(),
      testnetClient.oracle.parameters(),
      testnetClient.tendermint.blockInfo(),
    ]).catch(() => []) as [Coins, OracleParams, BlockInfo]

    if (!rates || !oracleParams || !latestBlock) {
      return Promise.resolve()
        .then(() => delay(5000))
        .then(main)
    }

    const oracleVotePeriod = oracleParams.vote_period;
    const currentBlockHeight = parseInt(latestBlock.block.header.height, 10);
    const currentVotePeriod = Math.floor(currentBlockHeight / oracleVotePeriod);
    const indexInVotePeriod = currentBlockHeight % oracleVotePeriod;

    if (
      (lastSuccessVotePeriod && lastSuccessVotePeriod === currentVotePeriod) ||
      indexInVotePeriod >= oracleVotePeriod - 1
    ) {
      return Promise.resolve()
        .then(() => delay(1000))
        .then(main)
    }

    const coins = rates
      .toArray()
      .map((r) => `${r.amount}${r.denom}`)
      .join(",");

    const voteMsg = new MsgAggregateExchangeRateVote(
      coins,
      randomBytes(2).toString('hex'),
      mk.accAddress,
      mk.valAddress
    );

    const msgs = [lastSuccessVoteMsg, voteMsg.getPrevote()].filter(Boolean);

    return Promise.resolve()
      .then(() => wallet.createAndSignTx({ msgs }))
      .then(tx => testnetClient.tx.broadcast(tx))
      .then(result => {
        console.log(
          `vote_period: ${currentVotePeriod}, txhash: ${result.txhash}`
        );

        lastSuccessVotePeriod = currentVotePeriod;
        lastSuccessVoteMsg = voteMsg;
      })
      .catch(err => console.error(err.message))
      .then(() => delay(5000))
      .then(main)
}


const app = () => Promise.resolve()
  .then(main)
  .then(console.error) // never care about the error
  .then(app)

Promise.resolve()
  .then(() => waitForFirstBlock(testnetClient))
  .then(app)
