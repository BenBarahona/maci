// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IMACI } from "../interfaces/IMACI.sol";
import { IVerifier } from "../interfaces/IVerifier.sol";
import { IVkRegistry } from "../interfaces/IVkRegistry.sol";

/// @title Params
/// @notice This contracts contains a number of structures
/// which are to be passed as parameters to Poll contracts.
/// This way we can reduce the number of parameters
/// and avoid a stack too deep error during compilation.
contract Params {
  /// @notice A struct holding the depths of the merkle trees
  struct TreeDepths {
    uint8 intStateTreeDepth;
    uint8 voteOptionTreeDepth;
  }

  /// @notice A struct holding the external contracts
  /// that are to be passed to a Poll contract on
  /// deployment
  struct ExtContracts {
    IMACI maci;
    IVerifier verifier;
    IVkRegistry vkRegistry;
  }
}
