# multiagent-container

## Thread Event History

Agent thread events are persisted in SQLite at `/agents/multiagent-container.db`.
The `/thread/:threadId` websocket still streams live events. Clients can request
stored events over the same websocket by sending:

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
