# Feedback Collector — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that allows users to submit, view, edit, and delete their own feedback items. Feedback is stored for later review and export. Users can submit text, photos, voice messages, and files, which are saved with metadata and timestamps. All actions are limited to the user's own feedback items.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram channel users
- service users

## Success criteria

- User can submit feedback with any message type and receive a reference ID
- User can view, edit, and delete their own feedback items
- All feedback is stored and can be exported later

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **Submit feedback** (command, actor: user, command: /send message) — Send text/photo/voice/file to submit feedback
  - inputs: message text, attachments
  - outputs: confirmation message with reference ID
- **/myfeedback** (command, actor: user, command: /myfeedback) — List user's feedback items with actions
  - inputs: user_id
  - outputs: paginated list of feedback items
- **/help** (command, actor: user, command: /help) — Show usage instructions and privacy note

## Flows

### submit_feedback
_Trigger:_ send message

1. User sends message
2. Bot confirms submission with reference ID

_Data touched:_ Feedback item

### view_feedback
_Trigger:_ View button

1. User selects View action
2. Bot shows full feedback details

_Data touched:_ Feedback item

### edit_feedback
_Trigger:_ Edit button

1. User selects Edit action
2. User sends new text/attachment
3. Bot updates feedback with new content

_Data touched:_ Feedback item

### delete_feedback
_Trigger:_ Delete button

1. User selects Delete action
2. User confirms deletion
3. Bot marks feedback as deleted

_Data touched:_ Feedback item

### list_feedback
_Trigger:_ /myfeedback

1. User requests feedback list
2. Bot shows paginated list of feedback items

_Data touched:_ Feedback item

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Feedback item** _(retention: persistent)_ — User-submitted feedback with metadata
  - fields: id, user_id, username, timestamp, text, attachments, status, last_edited
- **User** _(retention: persistent)_ — Telegram user record
  - fields: Telegram id, display name

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Export feedback data
- Purge deleted feedback after 30 days

## Permissions & privacy

- Users can only access their own feedback items
- Attachments are stored securely and linked to feedback items
- Soft-deleted feedback is retained for 30 days before purging

## Edge cases

- User tries to edit/delete feedback from another user
- User submits feedback without text (only attachment)
- User tries to access feedback list with no items

## Required tests

- User submits feedback and receives reference ID
- User views, edits, and deletes their own feedback
- Soft-deleted feedback is retained for 30 days

## Assumptions

- All incoming message types are stored as feedback items
- Each submission receives a short numeric ID and timestamp
- Feedback is soft-deleted by default with 30-day retention
