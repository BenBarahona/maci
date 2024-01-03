/* eslint-disable no-underscore-dangle */
import { expect } from "chai";
import { BaseContract, Signer } from "ethers";
import { EthereumProvider } from "hardhat/types";
import { MaciState, Poll, STATE_TREE_DEPTH, packProcessMessageSmallVals } from "maci-core";
import { NOTHING_UP_MY_SLEEVE } from "maci-crypto";
import { Keypair, Message, PubKey } from "maci-domainobjs";

import { parseArtifact } from "../ts/abi";
import { IVerifyingKeyStruct } from "../ts/types";
import { getDefaultSigner } from "../ts/utils";
import { MACI, MessageProcessor, Poll as PollContract } from "../typechain-types";

import {
  duration,
  initialVoiceCreditBalance,
  maxValues,
  messageBatchSize,
  testProcessVk,
  testTallyVk,
  treeDepths,
} from "./constants";
import { timeTravel, deployTestContracts } from "./utils";

describe("MessageProcessor", () => {
  // contracts
  let maciContract: MACI;
  let pollContract: PollContract;
  let mpContract: MessageProcessor;
  const [pollAbi] = parseArtifact("Poll");

  let pollId: number;

  // local poll and maci state
  let poll: Poll;
  const maciState = new MaciState(STATE_TREE_DEPTH);

  let signer: Signer;
  let generatedInputs: { newSbCommitment: bigint };
  const coordinator = new Keypair();

  const users = [new Keypair(), new Keypair()];

  before(async () => {
    signer = await getDefaultSigner();
    // deploy test contracts
    const r = await deployTestContracts(initialVoiceCreditBalance, STATE_TREE_DEPTH, signer, true);
    maciContract = r.maciContract;
    signer = await getDefaultSigner();
    mpContract = r.mpContract;

    // deploy on chain poll
    const tx = await maciContract.deployPoll(duration, maxValues, treeDepths, coordinator.pubKey.asContractParam(), {
      gasLimit: 8000000,
    });
    let receipt = await tx.wait();

    // extract poll id
    expect(receipt?.status).to.eq(1);
    const iface = maciContract.interface;
    const logs = receipt!.logs[receipt!.logs.length - 1];
    const event = iface.parseLog(logs as unknown as { topics: string[]; data: string }) as unknown as {
      args: { _pollId: number };
    };
    pollId = event.args._pollId;

    const pollContractAddress = await maciContract.getPoll(pollId);
    pollContract = new BaseContract(pollContractAddress, pollAbi, signer) as PollContract;

    const block = await signer.provider!.getBlock(receipt!.blockHash);
    const deployTime = block!.timestamp;

    // deploy local poll
    const p = maciState.deployPoll(BigInt(deployTime + duration), maxValues, treeDepths, messageBatchSize, coordinator);
    expect(p.toString()).to.eq(pollId.toString());

    // publish the NOTHING_UP_MY_SLEEVE message
    const messageData = [NOTHING_UP_MY_SLEEVE];
    for (let i = 1; i < 10; i += 1) {
      messageData.push(BigInt(0));
    }
    const message = new Message(BigInt(1), messageData);
    const padKey = new PubKey([
      BigInt("10457101036533406547632367118273992217979173478358440826365724437999023779287"),
      BigInt("19824078218392094440610104313265183977899662750282163392862422243483260492317"),
    ]);
    maciState.polls[pollId].publishMessage(message, padKey);

    poll = maciState.polls[pollId];
    generatedInputs = poll.processMessages(pollId) as typeof generatedInputs;

    // set the verification keys on the vk smart contract
    const vkContract = r.vkRegistryContract;
    await vkContract.setVerifyingKeys(
      STATE_TREE_DEPTH,
      treeDepths.intStateTreeDepth,
      treeDepths.messageTreeDepth,
      treeDepths.voteOptionTreeDepth,
      messageBatchSize,
      testProcessVk.asContractParam() as IVerifyingKeyStruct,
      testTallyVk.asContractParam() as IVerifyingKeyStruct,
      { gasLimit: 1000000 },
    );
    receipt = await tx.wait();
    expect(receipt?.status).to.eq(1);
  });

  describe("before merging acc queues", () => {
    before(async () => {
      await timeTravel(signer.provider! as unknown as EthereumProvider, duration + 1);
    });

    it("processMessages() should fail if the state AQ has not been merged", async () => {
      const pollContractAddress = await maciContract.getPoll(pollId);

      await expect(
        mpContract.processMessages(pollContractAddress, 0, [0, 0, 0, 0, 0, 0, 0, 0]),
      ).to.be.revertedWithCustomError(mpContract, "StateAqNotMerged");
    });
  });

  describe("after merging acc queues", () => {
    before(async () => {
      await pollContract.mergeMaciStateAqSubRoots(0, pollId);
      await pollContract.mergeMaciStateAq(0);

      await pollContract.mergeMessageAqSubRoots(0);
      await pollContract.mergeMessageAq();
    });

    it("genProcessMessagesPackedVals() should generate the correct value", async () => {
      const packedVals = packProcessMessageSmallVals(
        BigInt(maxValues.maxVoteOptions),
        BigInt(users.length),
        0,
        poll.messages.length,
      );
      const onChainPackedVals = BigInt(
        await mpContract.genProcessMessagesPackedVals(await pollContract.getAddress(), 0, users.length),
      );
      expect(packedVals.toString()).to.eq(onChainPackedVals.toString());
    });

    it("processMessages() should update the state and ballot root commitment", async () => {
      const pollContractAddress = await maciContract.getPoll(pollId);

      // Submit the proof
      const tx = await mpContract.processMessages(
        pollContractAddress,
        generatedInputs.newSbCommitment,
        [0, 0, 0, 0, 0, 0, 0, 0],
      );

      const receipt = await tx.wait();
      expect(receipt?.status).to.eq(1);

      const processingComplete = await mpContract.processingComplete();
      expect(processingComplete).to.eq(true);

      const onChainNewSbCommitment = await mpContract.sbCommitment();
      expect(generatedInputs.newSbCommitment).to.eq(onChainNewSbCommitment.toString());
    });
  });
});
