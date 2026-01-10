---
description: Check swarm mail inbox for messages from other agents
---

# /swarm:inbox

Review Swarm Mail without blowing context.

## Workflow
1. `swarmmail_inbox()` for headers (max 5).
2. `swarmmail_read_message(message_id)` for details.
3. `swarmmail_ack(message_id)` when handled.

## Usage
`/swarm:inbox`
