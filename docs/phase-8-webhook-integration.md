# Phase 8: OOO & Coverage Webhook Integration Guide

## Overview

This document describes the webhook events emitted by CalZero to Ground Zero OS (Ops) during the out-of-office (OOO) and coverage workflow. It explains what each event means, what data is sent, and what Ground Zero OS should do in response.

---

## Event Flow Diagram

```
1. Admin creates OOO for Trainer
   ↓
2. CalZero flags affected sessions → Emits OOO_CREATED
   ↓
3. For published sessions → Emits COVERAGE_NEEDED
   ↓
4. Ground Zero OS notifies facility staff
   ↓
5. Admin finds substitute trainer and reassigns
   ↓
6. CalZero updates session → Emits SESSION_TRAINER_CHANGED
   ↓
7. Ground Zero OS notifies athletes and staff
```

---

## Webhook Events

### 1. OOO_CREATED

**Purpose:** Notifies Ground Zero OS when a trainer creates an out-of-office entry.

**Trigger:** A trainer or admin creates a new OOO entry via `POST /ooo`.

**Function:** This event signals that a trainer will be unavailable during a specific time period. Ground Zero OS should store this information and prepare to handle coverage for affected sessions.

**CalZero Implementation:**
- Event type: `OOO_CREATED`
- Emitted by: `OooController.createOOO()`
- Stored in: `OutboxEvent` table with status "pending"
- Delivered by: `OutboxWorkerService` (background job polls every 30 seconds)

**Ground Zero OS Receives:**

```json
{
  "type": "OOO_CREATED",
  "occurredAt": "2024-12-10T15:30:00Z",
  "payload": {
    "oooId": 123,
    "trainerId": 456,
    "trainerName": "John Smith",
    "trainerEmail": "john@example.com",
    "start": "2024-12-15T00:00:00Z",
    "end": "2024-12-20T23:59:59Z",
    "notes": "Vacation in Hawaii",
    "reasonId": 2,
    "reason": "vacation",
    "affectedOccurrences": 5
  }
}
```

**Ground Zero OS Should:**

1. **Store OOO Entry**: Save the OOO period in your database for reference
2. **Alert Facility Staff**: Notify facility managers that coverage is needed
3. **Display in UI**: Show OOO status on trainer's profile and schedule views
4. **Track Coverage Status**: Mark this OOO entry as "pending coverage assignment"

**Expected Response:** HTTP 200 OK (acknowledgment that webhook was received)

---

### 2. COVERAGE_NEEDED

**Purpose:** Alerts Ground Zero OS that a specific session occurrence needs a substitute trainer because the assigned trainer is OOO.

**Trigger:**
- When an OOO entry is created and affects a **published** group session
- When an **internal** session with `needsCoverage=true` becomes **published** (via nightly HorizonPublishJob)

**Function:** This event means a session has enrolled athletes but no trainer. Ground Zero OS should prioritize finding coverage to avoid session cancellation.

**CalZero Implementation:**
- Event type: `COVERAGE_NEEDED`
- Emitted by:
  - `OooOccurrenceService.flagAffectedOccurrences()` (immediate, for published sessions)
  - `OooOccurrenceService.emitCoverageEventsForPublished()` (nightly job, for newly published sessions)
- Stored in: `OutboxEvent` table with status "pending"
- Delivered by: `OutboxWorkerService`

**Ground Zero OS Receives:**

```json
{
  "type": "COVERAGE_NEEDED",
  "occurredAt": "2024-12-10T15:30:05Z",
  "payload": {
    "occurrenceId": "cm3x8y9z0-abc-def",
    "trainerId": 456,
    "startTime": "2024-12-16T10:00:00Z",
    "endTime": "2024-12-16T11:00:00Z",
    "seriesId": "cm3series123",
    "enrollmentCount": 8
  }
}
```

**Ground Zero OS Should:**

1. **Display Alert**: Show prominent notification in admin dashboard
2. **Show Session Details**: Display which class needs coverage, when, and how many athletes are enrolled
3. **Suggest Substitutes**: Use the CalZero API to find eligible trainers:
   ```
   POST /coverage/eligibility
   {
     "occurrenceIds": ["cm3x8y9z0-abc-def"]
   }
   ```
4. **Enable Assignment**: Provide UI for admin to select substitute and confirm
5. **Track Urgency**: Prioritize sessions closer to start time
6. **Notify Staff**: Send push notification or email to facility managers

**Expected Response:** HTTP 200 OK

---

### 3. SESSION_TRAINER_CHANGED

**Purpose:** Confirms that a session has been successfully reassigned to a substitute trainer.

**Trigger:** An admin reassigns an occurrence to a substitute trainer via `POST /coverage/reassign`.

**Function:** This event signals that coverage has been secured. Ground Zero OS should notify affected athletes and update all UIs to show the new trainer.

**CalZero Implementation:**
- Event type: `SESSION_TRAINER_CHANGED`
- Emitted by: `OccurrenceReassignService.reassignSingleOccurrence()`
- Stored in: `OutboxEvent` table with status "pending"
- Delivered by: `OutboxWorkerService`

**Ground Zero OS Receives:**

```json
{
  "type": "SESSION_TRAINER_CHANGED",
  "occurredAt": "2024-12-10T16:45:00Z",
  "payload": {
    "occurrenceId": "cm3x8y9z0-abc-def",
    "fromTrainerId": 456,
    "toTrainerId": 789,
    "reason": "coverage_ooo",
    "seriesId": "cm3series123",
    "eventTypeId": 12,
    "startTime": "2024-12-16T10:00:00Z",
    "endTime": "2024-12-16T11:00:00Z",
    "reassignedBy": 101
  }
}
```

**Ground Zero OS Should:**

1. **Update Database**: Change the trainer ID for this occurrence
2. **Notify Athletes**: Send notification to all enrolled athletes:
   - "Your class on Dec 16 at 10am will now be taught by [New Trainer Name] instead of [Original Trainer Name]"
3. **Notify Trainers**:
   - **Original trainer**: Confirm coverage has been secured
   - **Substitute trainer**: Alert about new class assignment
4. **Update UI**: Refresh schedule views, class details, and trainer profiles
5. **Mark Coverage Complete**: Update OOO tracking to show this session is covered
6. **Log Activity**: Record the reassignment in audit trail

**Expected Response:** HTTP 200 OK

---

## Ground Zero OS API Endpoints

### Finding Eligible Coverage Trainers

**Endpoint:** `POST /coverage/eligibility`

**Purpose:** Ground Zero OS calls this to find which trainers are available to cover specific sessions.

**Request:**
```json
{
  "occurrenceIds": [
    "cm3x8y9z0-abc-def",
    "cm3x8y9z0-ghi-jkl"
  ]
}
```

**Response:**
```json
{
  "data": [
    {
      "occurrenceId": "cm3x8y9z0-abc-def",
      "eligibleTrainers": [
        {
          "trainerId": 789,
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        {
          "trainerId": 101,
          "name": "Bob Wilson",
          "email": "bob@example.com"
        }
      ]
    },
    {
      "occurrenceId": "cm3x8y9z0-ghi-jkl",
      "eligibleTrainers": [
        {
          "trainerId": 789,
          "name": "Jane Doe",
          "email": "jane@example.com"
        }
      ]
    }
  ]
}
```

**Function:** CalZero checks each trainer for conflicts (other bookings, OOO, holds) and returns only those who are truly available at the session time.

---

### Reassigning Sessions to Substitute Trainers

**Endpoint:** `POST /coverage/reassign`

**Purpose:** Ground Zero OS calls this to assign one or more sessions to substitute trainers.

**Request:**
```json
{
  "assignments": [
    {
      "occurrenceId": "cm3x8y9z0-abc-def",
      "toTrainerId": 789
    },
    {
      "occurrenceId": "cm3x8y9z0-ghi-jkl",
      "toTrainerId": 789
    }
  ]
}
```

**Response:**
```json
{
  "successes": [
    {
      "occurrenceId": "cm3x8y9z0-abc-def",
      "toTrainerId": 789
    }
  ],
  "failures": [
    {
      "occurrenceId": "cm3x8y9z0-ghi-jkl",
      "toTrainerId": 789,
      "error": "Trainer 789 has a conflict at 2024-12-16T14:00:00Z"
    }
  ]
}
```

**Function:** CalZero performs a final conflict check (in case another booking was made between eligibility check and reassignment), then updates the session trainer and emits `SESSION_TRAINER_CHANGED` event. Partial failures are allowed - some assignments may succeed while others fail.

---

## Webhook Delivery Mechanics

### CalZero Outbox Pattern

**How Events Are Sent:**

1. **Event Creation**: CalZero services call `OutboxService.createEvent()` to create event records
2. **Persistent Storage**: Events are stored in `OutboxEvent` table with status "pending"
3. **Background Worker**: `OutboxWorkerService` runs every 30 seconds
4. **Batch Delivery**: Worker fetches up to 100 pending events and sends them to configured webhook URL
5. **Retry Logic**: Failed deliveries are retried with exponential backoff (1m, 2m, 4m, 8m, 16m, 32m, 1h, 2h, 4h, 8h, 16h, 24h, 48h)
6. **Max Retry Window**: Events are retried for up to 72 hours before being marked as "failed"

### Expected Ground Zero OS Response

**Success:** HTTP 200-299 status code
- CalZero marks event as "delivered"
- `deliveredAt` timestamp is recorded

**Failure:** HTTP 400-599 status code or network error
- CalZero increments retry count
- `nextAttemptAt` is set based on exponential backoff
- Event remains in "pending" status

**Idempotency:** Ground Zero OS may receive duplicate events if:
- CalZero crashes after sending but before marking as delivered
- Network timeout causes retry
- **Ground Zero OS MUST handle duplicates gracefully** (use `occurredAt` + `payload` to detect duplicates)

---

## Sequence Diagrams

### Scenario 1: Create OOO and Flag Sessions

```
Admin → Ground Zero UI: Create OOO for Trainer A (Dec 15-20)
Ground Zero UI → CalZero API: POST /ooo
CalZero API → OooController: createOOO()
OooController → OooService: createUserOOO()
OooService → Database: Insert OutOfOfficeEntry
OooController → OooOccurrenceService: flagAffectedOccurrences()
OooOccurrenceService → Database: Query affected occurrences
OooOccurrenceService → Database: Update needsCoverage=true
OooOccurrenceService → OutboxService: createEvent("COVERAGE_NEEDED")
OutboxService → Database: Insert OutboxEvent (status: pending)
CalZero API → Ground Zero UI: Response (OOO created, 5 occurrences affected)

[30 seconds later]
OutboxWorker → Database: Poll pending events
OutboxWorker → Ground Zero Webhook: POST /webhooks (COVERAGE_NEEDED event)
Ground Zero Webhook → Database: Store coverage alert
Ground Zero Webhook → OutboxWorker: HTTP 200 OK
OutboxWorker → Database: Mark event delivered
```

### Scenario 2: Admin Assigns Coverage

```
Admin → Ground Zero UI: View sessions needing coverage
Ground Zero UI → CalZero API: POST /coverage/eligibility (occurrenceIds)
CalZero API → CoverageEligibilityService: findEligibleTrainers()
CoverageEligibilityService → Database: Query trainers, check conflicts
CalZero API → Ground Zero UI: List of available trainers

Admin → Ground Zero UI: Select Trainer B for coverage
Ground Zero UI → CalZero API: POST /coverage/reassign (occurrenceId, toTrainerId)
CalZero API → OccurrenceReassignService: reassignOccurrences()
OccurrenceReassignService → Database: Check final conflict
OccurrenceReassignService → Database: Update booking (userId, needsCoverage=false)
OccurrenceReassignService → OutboxService: createEvent("SESSION_TRAINER_CHANGED")
OutboxService → Database: Insert OutboxEvent (status: pending)
CalZero API → Ground Zero UI: Success response

[30 seconds later]
OutboxWorker → Database: Poll pending events
OutboxWorker → Ground Zero Webhook: POST /webhooks (SESSION_TRAINER_CHANGED event)
Ground Zero Webhook → Database: Update session trainer
Ground Zero Webhook → NotificationService: Notify athletes and trainers
Ground Zero Webhook → OutboxWorker: HTTP 200 OK
OutboxWorker → Database: Mark event delivered
```

---

## Error Handling

### What if Ground Zero OS is Down?

- CalZero will retry webhook delivery for up to 72 hours
- Events are queued in the outbox, so no data is lost
- Once Ground Zero OS is back online, events will be delivered in order

### What if a Reassignment Fails?

- CalZero returns partial failure in the response
- Ground Zero OS should display error message to admin
- Admin can retry with a different trainer

### What if an Event is Lost?

- Ground Zero OS should implement a **sync endpoint** that CalZero can call to reconcile state
- CalZero can provide a `GET /coverage/status` endpoint to query current coverage needs
- Ground Zero OS can poll this endpoint daily as a backup to webhooks

---

## Testing the Integration

### Manual Test: Create OOO and Verify Webhooks

1. **Create OOO Entry:**
   ```bash
   POST /ooo
   Authorization: Bearer <ops-jwt-token>
   {
     "start": "2024-12-15T00:00:00Z",
     "end": "2024-12-20T23:59:59Z",
     "reasonId": 2,
     "notes": "Test OOO"
   }
   ```

2. **Expected Webhooks:**
   - `OOO_CREATED` (immediate)
   - `COVERAGE_NEEDED` (one per affected published session, immediate)

3. **Check Outbox:**
   ```sql
   SELECT * FROM "OutboxEvent"
   WHERE type IN ('OOO_CREATED', 'COVERAGE_NEEDED')
   ORDER BY "occurredAt" DESC
   LIMIT 10;
   ```

4. **Verify Ground Zero OS Received:**
   - Check webhook logs
   - Verify UI shows coverage alerts

### Manual Test: Assign Coverage

1. **Get Eligible Trainers:**
   ```bash
   POST /coverage/eligibility
   Authorization: Bearer <ops-jwt-token>
   {
     "occurrenceIds": ["<occurrence-uid>"]
   }
   ```

2. **Reassign to Substitute:**
   ```bash
   POST /coverage/reassign
   Authorization: Bearer <ops-jwt-token>
   {
     "assignments": [
       {
         "occurrenceId": "<occurrence-uid>",
         "toTrainerId": <trainer-id>
       }
     ]
   }
   ```

3. **Expected Webhook:**
   - `SESSION_TRAINER_CHANGED` (within 30 seconds)

4. **Verify Database:**
   ```sql
   SELECT "uid", "userId", "needsCoverage", "reassignById", "reassignReason"
   FROM "Booking"
   WHERE "uid" = '<occurrence-uid>';
   ```

   Expected result:
   - `userId` = new trainer ID
   - `needsCoverage` = false
   - `reassignById` = admin user ID
   - `reassignReason` = 'coverage_ooo'

---

## Database Schema Reference

### OutboxEvent Table

```sql
CREATE TABLE "OutboxEvent" (
  "eventId"        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "type"           TEXT NOT NULL,                    -- Event type (e.g., "COVERAGE_NEEDED")
  "payload"        JSONB NOT NULL,                   -- Event data
  "status"         TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  "attempts"       INT NOT NULL DEFAULT 0,           -- Delivery retry count
  "occurredAt"     TIMESTAMP NOT NULL DEFAULT NOW(), -- When event was created
  "deliveredAt"    TIMESTAMP,                        -- When event was successfully delivered
  "nextAttemptAt"  TIMESTAMP,                        -- When to retry next (for failed deliveries)
  "error"          TEXT                              -- Last error message (for failed deliveries)
);
```

### OutOfOfficeEntry Table

```sql
CREATE TABLE "OutOfOfficeEntry" (
  "id"               SERIAL PRIMARY KEY,
  "uuid"             UUID UNIQUE NOT NULL,
  "userId"           INT NOT NULL,              -- Trainer who is OOO
  "start"            TIMESTAMP NOT NULL,        -- OOO start date
  "end"              TIMESTAMP NOT NULL,        -- OOO end date
  "notes"            TEXT,                      -- Optional notes
  "reasonId"         INT,                       -- FK to OutOfOfficeReason
  "toUserId"         INT,                       -- Optional redirect to another user
  "createdAt"        TIMESTAMP DEFAULT NOW(),
  "updatedAt"        TIMESTAMP DEFAULT NOW()
);
```

### Booking Table (Relevant Fields)

```sql
CREATE TABLE "Booking" (
  -- ... other fields ...
  "userId"           INT NOT NULL,              -- Assigned trainer
  "needsCoverage"    BOOLEAN DEFAULT FALSE,     -- Flagged when trainer is OOO
  "reassignById"     INT,                       -- User who performed reassignment
  "reassignReason"   TEXT,                      -- Reason for reassignment (e.g., "coverage_ooo")
  "publishState"     TEXT DEFAULT 'internal',   -- internal | published | cancelled
  "seriesId"         TEXT,                      -- Links to GroupSeries for recurring classes
  -- ... other fields ...
);
```

---

## Configuration

### CalZero Environment Variables

```env
# Ops JWT Public Key (for verifying tokens from Ground Zero OS)
OPS_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# Webhook URL (where to send events)
WEBHOOK_URL="https://groundzero.example.com/webhooks/calzero"

# Outbox Worker Settings
OUTBOX_POLL_INTERVAL_MS=30000      # Poll every 30 seconds
OUTBOX_BATCH_SIZE=100              # Process up to 100 events per batch
OUTBOX_MAX_RETRY_HOURS=72          # Give up after 72 hours
```

### Ground Zero OS Configuration

```env
# CalZero API Base URL
CALZERO_API_URL="https://api.calzero.example.com"

# CalZero API Authentication (JWT signed by Ground Zero OS)
CALZERO_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Webhook Secret (for verifying webhook signatures, if implemented)
CALZERO_WEBHOOK_SECRET="your-secret-key"
```

---

## Summary

### Key Points

1. **Three Event Types**: OOO_CREATED, COVERAGE_NEEDED, SESSION_TRAINER_CHANGED
2. **Reliable Delivery**: Events are stored in outbox and retried for up to 72 hours
3. **Partial Failures**: Reassignment API allows some assignments to succeed while others fail
4. **Idempotency**: Ground Zero OS must handle duplicate events gracefully
5. **Bi-Directional**: CalZero sends webhooks; Ground Zero OS calls REST APIs

### Ground Zero OS Responsibilities

- ✅ Receive and acknowledge webhooks (HTTP 200)
- ✅ Store coverage alerts and display in UI
- ✅ Call `/coverage/eligibility` to find available trainers
- ✅ Call `/coverage/reassign` to assign coverage
- ✅ Notify athletes and trainers about changes
- ✅ Handle duplicate events gracefully
- ✅ Implement sync mechanism as backup to webhooks

### CalZero Responsibilities

- ✅ Emit webhooks for all coverage-related events
- ✅ Retry failed deliveries with exponential backoff
- ✅ Provide APIs for finding eligible trainers and reassigning sessions
- ✅ Verify JWT tokens from Ground Zero OS
- ✅ Check for conflicts before reassigning sessions
- ✅ Update database and clear coverage flags after successful reassignment
