-- Existing turns are retained as a selectable historic conversation.
CREATE TABLE agent_conversations (
 id TEXT PRIMARY KEY,
 home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 title TEXT NOT NULL DEFAULT 'New chat',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_agent_conversations_owner ON agent_conversations(home_id,user_id,updated_at DESC);
ALTER TABLE agent_turns ADD COLUMN conversation_id TEXT REFERENCES agent_conversations(id) ON DELETE CASCADE;
INSERT INTO agent_conversations(id,home_id,user_id,title,created_at,updated_at)
SELECT 'legacy:' || home_id || ':' || user_id,home_id,user_id,'Previous chat',MIN(created_at),MAX(created_at) FROM agent_turns GROUP BY home_id,user_id;
UPDATE agent_turns SET conversation_id='legacy:' || home_id || ':' || user_id WHERE conversation_id IS NULL;
CREATE INDEX idx_agent_turn_conversation ON agent_turns(home_id,user_id,conversation_id,created_at DESC);
