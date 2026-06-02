// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HelloWorld {
    uint storedData;

    function getMessage() public pure returns (string memory) {
        return unicode"Hello from Blockchain 🚀";
    }

    function set(uint x) public {
        storedData = x;
    }

    function get() public view returns (uint) {
        return storedData;
    }
}
