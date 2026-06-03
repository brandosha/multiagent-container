# multiagent-container

## Thread Event History

Agent thread events are persisted in SQLite at `/agents/multiagent-container.db`.
Schema changes are managed with Drizzle migrations in `drizzle/`, using the
schema in `src/lib/db/schema.ts`.
The `/thread/:threadId` websocket accepts arbitrary string thread IDs. On
connection, the server maps that string ID to an auto-incrementing numeric
thread ID, creating the mapping if it does not already exist. The websocket
streams live events for the mapped thread. Historical events are not replayed
automatically on connection.

Prompt and abort requests must include `from` attribution:

```json
{
	"type": "prompt",
	"from": "trello-agent",
	"message": "Summarize the workspace."
}
```

```json
{
	"type": "abort",
	"from": "trello-agent"
}
```

Clients can update the latest per-thread configuration with a `config` message.
The optional `config.codex` object follows the public `CodexOptions` shape that
can be passed to `new Codex(...)`. The optional `config.git` object controls
root-proxy git behavior for the thread.

```json
{
	"type": "config",
	"from": "trello-agent",
	"config": {
		"codex": {
			"config": {
				"model": "gpt-5.2",
				"mcp_servers": {
					"external_docs": {
						"url": "https://example.com/mcp",
						"headers": {
							"Authorization": "Bearer token"
						}
					}
				}
			}
		},
		"git": {
			"username": "Agent",
			"branches": {
				"allow": ["feature/my-task"],
				"block": ["main"]
			}
		}
	}
}
```

`git.username` sets the agent user's global git `user.name` before root-proxy
git operations. `git.branches.allow` is an allow-list for push target branches;
when it exists, every pushed branch must be listed. If `allow` is omitted,
`git.branches.block` is used as a block-list. Force-push refspecs beginning
with `+` are always rejected.

The server records accepted config updates as `thread.config.updated` events.
Recorded config events preserve keys for traceability but redact values for
ALL_CAPS keys and known sensitive keys such as authorization headers, API keys,
tokens, secrets, and internal socket paths. User Codex options are merged with
required internal MCP, sandbox, approval, and IPC settings before each prompt;
internal reserved settings win on conflict.

Clients can request stored events over the same websocket by sending:

```json
{
	"type": "events.get",
	"limit": 100,
	"offset": 0
}
```

The server responds with:

```json
{
	"type": "thread.events",
	"threadId": 0,
	"limit": 100,
	"offset": 0,
	"events": []
}
```
