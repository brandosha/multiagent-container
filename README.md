# multiagent-container

## Thread Event History

Agent thread events are persisted in SQLite at `/agents/multiagent-container.db`.
Schema changes are managed with Drizzle migrations in `drizzle/`, using the
schema in `src/lib/db/schema.ts`.
The `/thread/:threadId` websocket accepts arbitrary string thread IDs. On
connection, the server maps that string ID to an auto-incrementing numeric
thread ID, creating the mapping if it does not already exist. The websocket
streams live events for the mapped thread. Clients can request stored events
over the same websocket by sending:

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

Historical events are not replayed automatically on connection.
