#!/bin/bash
# Demo helper: Run a CRE premium action and consume a credit
# Usage: ./demo-premium-action.sh <action>
# Actions: risk, compare, validate, analyze

set -e

ACTION=${1:-risk}
PAYER=0x564323aE0D8473103F3763814c5121Ca9e48004B
GATE=0x6eba1116C94f2E0eE9034062aB37f315866fF6B2
RPC=https://sepolia.infura.io/v3/b6652bb1dac64d0a96a7a01043b44ee4

cd "$(dirname "$0")/contract"
source .env
PK_CLEAN=$(echo -n "$PRIVATE_KEY" | tr -d '\n\r ')

# Check credits before
BEFORE=$(cast call $GATE "getCredits(address)(uint256)" $PAYER --rpc-url $RPC)
echo "Credits before: $BEFORE"

if [ "$BEFORE" -eq 0 ]; then
  echo "No credits remaining. Purchase more first."
  exit 1
fi

# Run CRE action
echo "Running CRE action: $ACTION"
cd ../DeBOR
cre workflow simulate ./DeBOR-Workflow --non-interactive --trigger-index 7 \
  --http-payload "{\"action\":\"$ACTION\",\"payer\":\"$PAYER\"}" \
  --target staging-settings --broadcast 2>&1 | tail -30

# Consume 1 credit
echo ""
echo "Consuming 1 credit..."
cd ../contract
cast send $GATE "consumeCredit(address)" $PAYER \
  --rpc-url $RPC --private-key "$PK_CLEAN" --quiet 2>&1

# Check credits after
AFTER=$(cast call $GATE "getCredits(address)(uint256)" $PAYER --rpc-url $RPC)
echo "Credits after: $AFTER (consumed 1)"
