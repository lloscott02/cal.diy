# CalZero → Ground Zero OS: Complete Webhook Integration Guide

## Overview

This document describes **all webhook events** emitted by CalZero to Ground Zero OS across all implementation phases. CalZero uses a reliable outbox pattern to ensure every event is delivered, with automatic retries for up to 72 hours.

**Total Events:** 15 webhook events across 5 functional areas

---

## Table of Contents

1. [Event Flow Overview](#event-flow-overview)
2. [Webhook Delivery System](#webhook-delivery-system)
3. [Schedule Management Events](#schedule-management-events-phase-1-2)
4. [Group Management Events](#group-management-events-phase-2-3)
5. [Enrollment Management Events](#enrollment-management-events-phase-3-4)
6. [Hold Management Events](#hold-management-events-phase-4-5)
7. [OOO & Coverage Events](#ooo--coverage-events-phase-8)
8. [Ground Zero OS Implementation Guide](#ground-zero-os-implementation-guide)
9. [Testing & Troubleshooting](#testing--troubleshooting)

---

## Event Flow Overview

```
CalZero API Action
    ↓
Service creates OutboxEvent
    ↓
OutboxWorkerService (runs every 30s)
    ↓
Signs payload with HMAC-SHA256
    ↓
POST to Ground Zero OS webhook URL
    ↓
Ground Zero OS processes & returns HTTP 200
    ↓
CalZero marks event as "delivered"

[If failure: Retry with exponential backoff for up to 72 hours]
```

---

## Webhook Delivery System

### How CalZero Sends Events

**CalZero Implementation:**
- **Service:** `OutboxWorkerService` runs every 30 seconds
- **Location:** `apps/api/v2/src/modules/outbox/services/outbox-worker.service.ts`
- **Pattern:** Outbox pattern for guaranteed delivery
- **Batch Size:** Up to 50 events per poll
- **Retry Logic:** Exponential backoff (1m, 2m, 4m, 8m, 16m, 32m, 1h, 2h, 4h, 8h, 16h, 24h, 48h)
- **Max Retry:** 72 hours before marking as permanently failed
- **Security:** Events signed with `X-CalZero-Signature-256` header (HMAC-SHA256)

### Webhook Request Format

**Headers:**
```
POST /webhooks/calzero
Content-Type: application/json
X-CalZero-Signature-256: sha256=<hmac-signature>
X-CalZero-Event-Type: <event-type>
X-CalZero-Event-ID: <uuid>
```

**Body:**
```json
{
  "type": "<EVENT_TYPE>",
  "occurredAt": "2024-12-10T15:30:00Z",
  "payload": {
    // Event-specific data
  }
}
```

### Ground Zero OS Webhook Endpoint

**Ground Zero OS Should:**

1. **Verify Signature:**
   ```go
   func verifyWebhookSignature(body []byte, signature string, secret string) bool {
       mac := hmac.New(sha256.New, []byte(secret))
       mac.Write(body)
       expectedSignature := "sha256=" + hex.EncodeToString(mac.Sum(nil))
       return hmac.Equal([]byte(signature), []byte(expectedSignature))
   }
   ```

2. **Handle Idempotency:**
   - Store event IDs in database
   - Skip processing if event ID already exists
   - Always return HTTP 200 (even for duplicates)

3. **Process Asynchronously:**
   - Acknowledge immediately with HTTP 200
   - Queue event for background processing
   - Don't block webhook response with heavy operations

4. **Return Proper Status Codes:**
   - **200-299:** Success (event marked as delivered)
   - **400-499:** Client error (CalZero will NOT retry - event marked as failed)
   - **500-599:** Server error (CalZero will retry with backoff)

---

## Schedule Management Events (Phase 1-2)

### 1. SCHEDULE_UPDATED

**Purpose:** Notifies Ground Zero OS when a trainer's working hours schedule is updated.

**Trigger:** Admin updates a trainer's availability schedule via CalZero UI or API.

**Function:** This event signals that a trainer's available working hours have changed. Ground Zero OS should update its scheduling system to reflect the new availability and recalculate any scheduling conflicts or capacity metrics.

**CalZero Implementation:**
- **Event Type:** `SCHEDULE_UPDATED`
- **Emitted By:** `SchedulesController.updateSchedule()`
- **File:** `apps/api/v2/src/modules/schedules/controllers/schedules.controller.ts:155`
- **Trigger:** `POST /v2/schedules/:trainerId`

**Ground Zero OS Receives:**

```json
{
  "type": "SCHEDULE_UPDATED",
  "occurredAt": "2024-12-10T15:30:00Z",
  "payload": {
    "trainerId": 456,
    "opsUserId": "trainer-abc-123",
    "scheduleId": 789,
    "workingHours": [
      {
        "days": [1, 2, 3, 4, 5],
        "startTime": 480,
        "endTime": 1020
      }
    ],
    "updatedAt": "2024-12-10T15:30:00Z"
  }
}
```

**Payload Fields:**
- `trainerId` (number) - CalZero internal user ID
- `opsUserId` (string) - Ground Zero OS user identifier
- `scheduleId` (number) - CalZero schedule ID
- `workingHours` (array) - Array of working hour blocks
  - `days` (array of numbers) - Days of week (0=Sunday, 6=Saturday)
  - `startTime` (number) - Minutes since midnight (480 = 8:00 AM)
  - `endTime` (number) - Minutes since midnight (1020 = 5:00 PM)
- `updatedAt` (ISO datetime) - When the schedule was updated

**Ground Zero OS Should:**

1. **Update Trainer Schedule:**
   ```go
   func handleScheduleUpdated(payload ScheduleUpdatedPayload) {
       trainer := db.GetTrainerByOpsUserId(payload.OpsUserId)
       trainer.WorkingHours = payload.WorkingHours
       db.SaveTrainer(trainer)
   }
   ```

2. **Recalculate Availability:**
   - Update trainer's available time slots for booking
   - Invalidate any cached availability data

3. **Check for Conflicts:**
   - Identify existing bookings that fall outside new schedule
   - Alert admin if classes are scheduled during new unavailable times

4. **Update UI:**
   - Refresh trainer profile pages
   - Update facility schedule view
   - Notify scheduling coordinators of changes

5. **Audit Trail:**
   - Log schedule change with timestamp
   - Track who made the change (if provided)

---

### 2. TIME_BLOCK_CREATED

**Purpose:** Notifies Ground Zero OS when a trainer creates a personal time block (temporary unavailability).

**Trigger:** Trainer creates a one-time block of unavailable time (e.g., personal appointment, break, lunch).

**Function:** This event marks a specific time range as unavailable for booking. Unlike OOO entries, time blocks are shorter and don't require coverage - they're just personal time. Ground Zero OS should block this time from being bookable.

**CalZero Implementation:**
- **Event Type:** `TIME_BLOCK_CREATED`
- **Emitted By:** `SchedulesController.createTimeBlock()`
- **File:** `apps/api/v2/src/modules/schedules/controllers/schedules.controller.ts:217`
- **Trigger:** `POST /v2/schedules/:trainerId/time-blocks`

**Ground Zero OS Receives:**

```json
{
  "type": "TIME_BLOCK_CREATED",
  "occurredAt": "2024-12-10T15:30:00Z",
  "payload": {
    "timeBlockId": 101,
    "trainerId": 456,
    "opsUserId": "trainer-abc-123",
    "startTime": "2024-12-15T12:00:00Z",
    "endTime": "2024-12-15T13:00:00Z",
    "note": "Lunch break",
    "createdAt": "2024-12-10T15:30:00Z"
  }
}
```

**Payload Fields:**
- `timeBlockId` (number) - CalZero time block ID
- `trainerId` (number) - CalZero internal user ID
- `opsUserId` (string) - Ground Zero OS user identifier
- `startTime` (ISO datetime) - Block start time
- `endTime` (ISO datetime) - Block end time
- `note` (string or null) - Optional note about the block
- `createdAt` (ISO datetime) - When the block was created

**Ground Zero OS Should:**

1. **Block Time Slot:**
   ```go
   func handleTimeBlockCreated(payload TimeBlockCreatedPayload) {
       timeBlock := TimeBlock{
           ID: payload.TimeBlockId,
           TrainerOpsId: payload.OpsUserId,
           StartTime: parseTime(payload.StartTime),
           EndTime: parseTime(payload.EndTime),
           Note: payload.Note,
       }
       db.CreateTimeBlock(timeBlock)
   }
   ```

2. **Update Availability:**
   - Remove this time slot from trainer's bookable hours
   - Invalidate cached availability for this trainer

3. **Prevent Bookings:**
   - Block this time from appearing in booking search results
   - Reject any booking attempts during this window

4. **Display in UI:**
   - Show time block on trainer's schedule/calendar view
   - Display note (if provided) when hovering over block

5. **Alert if Conflict:**
   - If there's already a booking during this time, alert admin
   - Provide option to reschedule or cancel conflicting booking

---

### 3. TIME_BLOCK_DELETED

**Purpose:** Notifies Ground Zero OS when a trainer deletes a time block, making that time available again.

**Trigger:** Trainer cancels a previously created time block.

**Function:** This event re-opens a previously blocked time slot. Ground Zero OS should remove the block and make the time bookable again (if it falls within the trainer's regular working hours).

**CalZero Implementation:**
- **Event Type:** `TIME_BLOCK_DELETED`
- **Emitted By:** `SchedulesController.deleteTimeBlock()`
- **File:** `apps/api/v2/src/modules/schedules/controllers/schedules.controller.ts:260`
- **Trigger:** `DELETE /v2/schedules/time-blocks/:id`

**Ground Zero OS Receives:**

```json
{
  "type": "TIME_BLOCK_DELETED",
  "occurredAt": "2024-12-10T16:00:00Z",
  "payload": {
    "timeBlockId": 101,
    "trainerId": 456,
    "opsUserId": "trainer-abc-123",
    "startTime": "2024-12-15T12:00:00Z",
    "endTime": "2024-12-15T13:00:00Z",
    "deletedAt": "2024-12-10T16:00:00Z"
  }
}
```

**Payload Fields:**
- `timeBlockId` (number) - CalZero time block ID
- `trainerId` (number) - CalZero internal user ID
- `opsUserId` (string) - Ground Zero OS user identifier
- `startTime` (ISO datetime) - Block start time (for reference)
- `endTime` (ISO datetime) - Block end time (for reference)
- `deletedAt` (ISO datetime) - When the block was deleted

**Ground Zero OS Should:**

1. **Remove Time Block:**
   ```go
   func handleTimeBlockDeleted(payload TimeBlockDeletedPayload) {
       db.DeleteTimeBlock(payload.TimeBlockId)
   }
   ```

2. **Restore Availability:**
   - Add time slot back to trainer's bookable hours
   - Invalidate cached availability

3. **Update UI:**
   - Remove time block from calendar displays
   - Refresh schedule views

4. **Enable Bookings:**
   - Make time slot searchable/bookable again
   - Include in availability queries

---

## Group Management Events (Phase 2-3)

### 4. GROUP_CREATED

**Purpose:** Notifies Ground Zero OS when a new recurring group class series is created.

**Trigger:** Admin creates a new group series (e.g., "Monday 10am Spin Class").

**Function:** This event signals that a new recurring class has been set up in the facility's schedule. Ground Zero OS should create the series in its database, set up the recurring schedule, and make it available for athlete enrollment. This is a foundational event - the series exists but individual occurrences are managed separately.

**CalZero Implementation:**
- **Event Type:** `GROUP_CREATED`
- **Emitted By:** `GroupsController.createGroup()`
- **File:** `apps/api/v2/src/modules/groups/controllers/groups.controller.ts:84`
- **Trigger:** `POST /v2/groups`

**Ground Zero OS Receives:**

```json
{
  "type": "GROUP_CREATED",
  "occurredAt": "2024-12-10T15:30:00Z",
  "payload": {
    "seriesId": "cm3series123",
    "trainerId": 456,
    "opsUserId": "trainer-abc-123",
    "name": "Monday Morning Spin Class",
    "weekday": "monday",
    "localStartTime": "10:00",
    "duration": 60,
    "softCap": 15,
    "hardCap": 20,
    "startsOn": "2024-12-16T00:00:00Z",
    "endsOn": null,
    "catalogItemId": "catalog-item-789",
    "createdAt": "2024-12-10T15:30:00Z"
  }
}
```

**Payload Fields:**
- `seriesId` (string) - CalZero unique series identifier
- `trainerId` (number) - CalZero internal trainer ID
- `opsUserId` (string) - Ground Zero OS trainer identifier
- `name` (string) - Class name/description
- `weekday` (string) - Day of week (monday, tuesday, etc.)
- `localStartTime` (string) - Start time in facility timezone (HH:MM format)
- `duration` (number) - Class duration in minutes
- `softCap` (number) - Enrollment threshold for alerts (e.g., "class is filling up")
- `hardCap` (number) - Maximum enrollment capacity
- `startsOn` (ISO datetime) - Series start date
- `endsOn` (ISO datetime or null) - Series end date (null = ongoing)
- `catalogItemId` (string) - Reference to class type in Ground Zero catalog
- `createdAt` (ISO datetime) - When series was created

**Ground Zero OS Should:**

1. **Create Series Record:**
   ```go
   func handleGroupCreated(payload GroupCreatedPayload) {
       series := GroupSeries{
           SeriesId: payload.SeriesId,
           TrainerOpsId: payload.OpsUserId,
           Name: payload.Name,
           Weekday: payload.Weekday,
           LocalStartTime: payload.LocalStartTime,
           Duration: payload.Duration,
           SoftCap: payload.SoftCap,
           HardCap: payload.HardCap,
           StartsOn: parseDate(payload.StartsOn),
           EndsOn: parseNullableDate(payload.EndsOn),
           CatalogItemId: payload.CatalogItemId,
       }
       db.CreateGroupSeries(series)
   }
   ```

2. **Generate Recurring Schedule:**
   - Calculate all occurrence dates based on weekday and date range
   - Note: CalZero manages individual occurrences internally

3. **Display in Catalog:**
   - Add to facility's class schedule
   - Show in athlete-facing booking interface
   - Display capacity limits (soft/hard cap)

4. **Enable Enrollment:**
   - Make series available for athlete enrollment
   - Set up enrollment tracking for soft cap alerts

5. **Notify Staff:**
   - Alert facility managers about new class
   - Notify assigned trainer about new recurring commitment

6. **Update Capacity Planning:**
   - Add to facility capacity metrics
   - Track utilization against capacity goals

---

### 5. GROUP_UPDATED

**Purpose:** Notifies Ground Zero OS when a group series is modified (name, time, capacity, etc.).

**Trigger:** Admin edits an existing group series with changes effective from a specific date.

**Function:** This event signals that a recurring class has been modified. The changes apply from an "effective date" forward - past occurrences remain unchanged. Ground Zero OS should update the series and handle the transition between old and new configurations.

**CalZero Implementation:**
- **Event Type:** `GROUP_UPDATED`
- **Emitted By:** `GroupsController.editGroup()`
- **File:** `apps/api/v2/src/modules/groups/controllers/groups.controller.ts:203`
- **Trigger:** `POST /v2/groups/:id/edit`

**Ground Zero OS Receives:**

```json
{
  "type": "GROUP_UPDATED",
  "occurredAt": "2024-12-10T15:45:00Z",
  "payload": {
    "seriesId": "cm3series123",
    "effectiveDate": "2024-12-23T00:00:00Z",
    "changes": {
      "name": "Monday Morning Advanced Spin",
      "localStartTime": "09:30",
      "duration": 75,
      "softCap": 18,
      "hardCap": 22
    },
    "updatedAt": "2024-12-10T15:45:00Z"
  }
}
```

**Payload Fields:**
- `seriesId` (string) - CalZero unique series identifier
- `effectiveDate` (ISO datetime) - When changes take effect (changes apply to this date and forward)
- `changes` (object) - Fields that were changed (only changed fields are included)
  - `name` (string, optional) - New class name
  - `localStartTime` (string, optional) - New start time (HH:MM)
  - `duration` (number, optional) - New duration in minutes
  - `softCap` (number, optional) - New soft capacity
  - `hardCap` (number, optional) - New hard capacity
- `updatedAt` (ISO datetime) - When update was made

**Ground Zero OS Should:**

1. **Apply Changes from Effective Date:**
   ```go
   func handleGroupUpdated(payload GroupUpdatedPayload) {
       series := db.GetSeriesBySeriesId(payload.SeriesId)

       // Update series with new values
       if payload.Changes.Name != "" {
           series.Name = payload.Changes.Name
       }
       if payload.Changes.LocalStartTime != "" {
           series.LocalStartTime = payload.Changes.LocalStartTime
       }
       // ... apply other changes

       db.SaveSeries(series)

       // Update future occurrences starting from effective date
       db.UpdateFutureOccurrences(
           payload.SeriesId,
           parseDate(payload.EffectiveDate),
           payload.Changes,
       )
   }
   ```

2. **Handle Time Changes:**
   - If start time or duration changed, update all future occurrence times
   - Alert athletes enrolled in affected classes about time change

3. **Handle Capacity Changes:**
   - If hard cap decreased below current enrollments, flag overbooked classes
   - If soft cap changed, update alert thresholds

4. **Notify Affected Athletes:**
   - Send notification to all athletes enrolled in future classes:
     - "Your Monday Spin Class is changing to 9:30 AM starting Dec 23"
   - Include all relevant changes in the notification

5. **Update UI:**
   - Refresh class schedule displays
   - Update series details page
   - Show "effective from [date]" indicator if changes are future-dated

6. **Audit Trail:**
   - Log what changed, when it takes effect, and who made the change
   - Keep history of series modifications

---

### 6. SERIES_ENDED

**Purpose:** Notifies Ground Zero OS when a group series is permanently ended.

**Trigger:** Admin ends a recurring group series (e.g., trainer leaves, class discontinued).

**Function:** This event signals that a recurring class is being discontinued. No new occurrences should be generated after the end date. Existing future occurrences should be cancelled. Ground Zero OS should notify enrolled athletes and remove the series from the active class schedule.

**CalZero Implementation:**
- **Event Type:** `SERIES_ENDED`
- **Emitted By:** `GroupsController.endGroup()`
- **File:** `apps/api/v2/src/modules/groups/controllers/groups.controller.ts:259`
- **Trigger:** `POST /v2/groups/:id/end`

**Ground Zero OS Receives:**

```json
{
  "type": "SERIES_ENDED",
  "occurredAt": "2024-12-10T16:00:00Z",
  "payload": {
    "seriesId": "cm3series123",
    "endDate": "2024-12-20T00:00:00Z",
    "endedAt": "2024-12-10T16:00:00Z"
  }
}
```

**Payload Fields:**
- `seriesId` (string) - CalZero unique series identifier
- `endDate` (ISO datetime) - Last date series runs (classes after this date are cancelled)
- `endedAt` (ISO datetime) - When the series was ended (administrative timestamp)

**Ground Zero OS Should:**

1. **End Series:**
   ```go
   func handleSeriesEnded(payload SeriesEndedPayload) {
       series := db.GetSeriesBySeriesId(payload.SeriesId)
       series.EndsOn = parseDate(payload.EndDate)
       series.Status = "ended"
       db.SaveSeries(series)

       // Cancel all future occurrences after end date
       affectedOccurrences := db.CancelOccurrencesAfter(
           payload.SeriesId,
           parseDate(payload.EndDate),
       )
   }
   ```

2. **Cancel Future Classes:**
   - Mark all occurrences after end date as cancelled
   - Process cancellations according to cancellation policy
   - Issue refunds/credits as appropriate

3. **Notify Enrolled Athletes:**
   - Send notification to all athletes with future enrollments:
     - "Your Monday Spin Class series is ending on Dec 20"
     - "Classes after this date have been cancelled"
     - "You have been credited/refunded for cancelled classes"
   - List which specific classes were cancelled

4. **Remove from Schedule:**
   - Remove series from active class listings
   - Mark as "ended" in historical records
   - Update facility capacity planning

5. **Notify Trainer:**
   - Alert trainer that series has ended
   - Remove from their active class assignments

6. **Update UI:**
   - Remove from class catalog (or mark as "no longer offered")
   - Show end date on series detail page
   - Update trainer schedule

---

### 7. GROUP_SOFT_CAP_REACHED

**Purpose:** Alerts Ground Zero OS when a group session reaches its soft capacity threshold.

**Trigger:** An enrollment is confirmed and the total enrollment count equals or exceeds the soft cap.

**Function:** This event is an early warning that a class is filling up. The soft cap is typically 75-80% of hard cap. Ground Zero OS should alert staff to consider opening an additional section or waitlist. Athletes can still enroll up to the hard cap.

**CalZero Implementation:**
- **Event Type:** `GROUP_SOFT_CAP_REACHED`
- **Emitted By:** `ConfirmService.confirmGroupHold()`
- **File:** `apps/api/v2/src/modules/holds/services/confirm.service.ts:131`
- **Trigger:** Enrollment confirmation that brings count to soft cap

**Ground Zero OS Receives:**

```json
{
  "type": "GROUP_SOFT_CAP_REACHED",
  "occurredAt": "2024-12-10T16:15:00Z",
  "payload": {
    "seriesId": "cm3series123",
    "occurrenceId": "cm3occ456",
    "softCap": 15,
    "hardCap": 20,
    "currentSeats": 15
  }
}
```

**Payload Fields:**
- `seriesId` (string) - Group series identifier
- `occurrenceId` (string) - Specific occurrence that reached soft cap
- `softCap` (number) - Soft capacity threshold
- `hardCap` (number) - Maximum capacity
- `currentSeats` (number) - Current enrollment count (equals or exceeds soft cap)

**Ground Zero OS Should:**

1. **Alert Staff:**
   ```go
   func handleSoftCapReached(payload SoftCapReachedPayload) {
       occurrence := db.GetOccurrenceById(payload.OccurrenceId)
       series := db.GetSeriesBySeriesId(payload.SeriesId)

       // Send alert to facility managers
       notification := Notification{
           Type: "soft_cap_reached",
           Title: fmt.Sprintf("%s is filling up", series.Name),
           Message: fmt.Sprintf(
               "Class on %s has %d/%d spots filled (soft cap: %d)",
               occurrence.StartTime.Format("Jan 2"),
               payload.CurrentSeats,
               payload.HardCap,
               payload.SoftCap,
           ),
           Priority: "medium",
       }
       notificationService.SendToFacilityManagers(notification)
   }
   ```

2. **Display UI Indicator:**
   - Show "Almost Full" or "Filling Fast" badge on class listing
   - Display enrollment count: "15/20 spots filled"
   - Use visual indicator (e.g., yellow/orange color)

3. **Consider Actions:**
   - Suggest to admin: "Consider opening another section?"
   - Show waitlist option if not already enabled
   - Track which classes frequently hit soft cap

4. **Update Metrics:**
   - Track utilization percentage
   - Flag high-demand classes for capacity planning

5. **Notify Marketing:**
   - Popular classes can be promoted
   - Use for demand forecasting

**Note:** This is an informational event - no action is required. Staff may choose to open additional sections or waitlists.

---

### 8. SERIES_ENROLLMENT_CREATED

**Purpose:** Notifies Ground Zero OS when an athlete enrolls in an ongoing group series (not just a single class).

**Trigger:** Athlete enrolls in multiple future occurrences of a recurring class.

**Function:** This event signals that an athlete has committed to attending multiple classes in a series. Ground Zero OS should track the enrollment, reserve spots in all covered occurrences, and manage the enrollment lifecycle (start date, end date, cancellations).

**CalZero Implementation:**
- **Event Type:** `SERIES_ENROLLMENT_CREATED`
- **Emitted By:** `GroupsController.enrollInSeries()`
- **File:** `apps/api/v2/src/modules/groups/controllers/groups.controller.ts:301`
- **Trigger:** `POST /v2/series/:id/enroll`

**Ground Zero OS Receives:**

```json
{
  "type": "SERIES_ENROLLMENT_CREATED",
  "occurredAt": "2024-12-10T16:30:00Z",
  "payload": {
    "enrollmentId": "enroll-uuid-123",
    "seriesId": "cm3series123",
    "athleteId": "athlete-456",
    "startsOn": "2024-12-16T00:00:00Z",
    "endsOn": null,
    "createdAt": "2024-12-10T16:30:00Z"
  }
}
```

**Payload Fields:**
- `enrollmentId` (string) - Unique enrollment identifier
- `seriesId` (string) - Group series identifier
- `athleteId` (string) - Ground Zero OS athlete identifier
- `startsOn` (ISO datetime) - First class date athlete will attend
- `endsOn` (ISO datetime or null) - Last class date (null = ongoing until cancelled)
- `createdAt` (ISO datetime) - When enrollment was created

**Ground Zero OS Should:**

1. **Create Series Enrollment:**
   ```go
   func handleSeriesEnrollmentCreated(payload SeriesEnrollmentPayload) {
       enrollment := SeriesEnrollment{
           EnrollmentId: payload.EnrollmentId,
           SeriesId: payload.SeriesId,
           AthleteId: payload.AthleteId,
           StartsOn: parseDate(payload.StartsOn),
           EndsOn: parseNullableDate(payload.EndsOn),
           Status: "active",
       }
       db.CreateSeriesEnrollment(enrollment)

       // Reserve spots in all applicable occurrences
       occurrences := db.GetFutureOccurrences(
           payload.SeriesId,
           parseDate(payload.StartsOn),
           parseNullableDate(payload.EndsOn),
       )

       for _, occurrence := range occurrences {
           db.CreateOccurrenceEnrollment(
               occurrence.Id,
               payload.AthleteId,
               payload.EnrollmentId,
           )
       }
   }
   ```

2. **Reserve Capacity:**
   - Reserve a spot in all covered occurrences
   - Update available capacity for each class
   - Track series vs. drop-in enrollments separately

3. **Notify Athlete:**
   - Send confirmation of series enrollment
   - List all classes they're enrolled in
   - Provide cancellation/rescheduling options

4. **Update UI:**
   - Show enrollment on athlete's schedule/calendar
   - Display "Series Member" or "Regular" badge
   - Show enrollment count for series

5. **Track Metrics:**
   - Series vs. drop-in enrollment ratio
   - Series retention rate
   - Revenue from series enrollments

6. **Handle Billing:**
   - Set up recurring billing if applicable
   - Track package/series usage

---

## Enrollment Management Events (Phase 3-4)

### 9. ENROLLMENT_CONFIRMED

**Purpose:** Confirms that an athlete's enrollment has been finalized (for both group and private sessions).

**Trigger:** An athlete's hold is confirmed, converting it to a confirmed enrollment/booking.

**Function:** This event signals that an athlete is officially enrolled. The hold period has ended, payment has been processed (if required), and the athlete is guaranteed a spot. Ground Zero OS should finalize the booking, trigger any post-enrollment workflows, and send confirmation to the athlete.

**CalZero Implementation:**
- **Event Type:** `ENROLLMENT_CONFIRMED`
- **Emitted By:** `ConfirmService.confirmGroupHold()` and `ConfirmService.confirmPrivateHold()`
- **Files:**
  - Group: `apps/api/v2/src/modules/holds/services/confirm.service.ts:141`
  - Private: `apps/api/v2/src/modules/holds/services/confirm.service.ts:203`
- **Trigger:** Hold confirmation via API

**Ground Zero OS Receives (GROUP):**

```json
{
  "type": "ENROLLMENT_CONFIRMED",
  "occurredAt": "2024-12-10T16:45:00Z",
  "payload": {
    "enrollmentId": "seat-uuid-123",
    "kind": "GROUP",
    "athleteId": "athlete-456",
    "enrollmentType": "dropin",
    "occurrenceId": "cm3occ789",
    "seriesId": "cm3series123",
    "trainerId": 456,
    "startsAt": "2024-12-16T10:00:00Z",
    "endsAt": "2024-12-16T11:00:00Z",
    "confirmedAt": "2024-12-10T16:45:00Z"
  }
}
```

**Ground Zero OS Receives (PRIVATE):**

```json
{
  "type": "ENROLLMENT_CONFIRMED",
  "occurredAt": "2024-12-10T16:50:00Z",
  "payload": {
    "enrollmentId": "booking-uuid-456",
    "kind": "PRIVATE",
    "athleteId": "athlete-789",
    "athleteLabel": "John Smith",
    "bookingId": "booking-abc-123",
    "trainerId": 456,
    "startsAt": "2024-12-17T14:00:00Z",
    "endsAt": "2024-12-17T15:00:00Z",
    "confirmedAt": "2024-12-10T16:50:00Z"
  }
}
```

**Payload Fields (GROUP):**
- `enrollmentId` (string) - BookingSeat UUID
- `kind` (string) - Always "GROUP"
- `athleteId` (string) - Ground Zero OS athlete identifier
- `enrollmentType` (string) - "dropin" (single class) or "series" (recurring)
- `occurrenceId` (string) - Specific class occurrence
- `seriesId` (string) - Group series identifier
- `trainerId` (number) - CalZero trainer ID
- `startsAt` (ISO datetime) - Class start time
- `endsAt` (ISO datetime) - Class end time
- `confirmedAt` (ISO datetime) - When enrollment was confirmed

**Payload Fields (PRIVATE):**
- `enrollmentId` (string) - Booking UUID
- `kind` (string) - Always "PRIVATE"
- `athleteId` (string) - Ground Zero OS athlete identifier
- `athleteLabel` (string) - Athlete display name
- `bookingId` (string) - Booking identifier
- `trainerId` (number) - CalZero trainer ID
- `startsAt` (ISO datetime) - Session start time
- `endsAt` (ISO datetime) - Session end time
- `confirmedAt` (ISO datetime) - When enrollment was confirmed

**Ground Zero OS Should:**

1. **Finalize Enrollment:**
   ```go
   func handleEnrollmentConfirmed(payload EnrollmentConfirmedPayload) {
       if payload.Kind == "GROUP" {
           enrollment := db.GetGroupEnrollment(payload.EnrollmentId)
           enrollment.Status = "confirmed"
           enrollment.ConfirmedAt = parseTime(payload.ConfirmedAt)
           db.SaveGroupEnrollment(enrollment)
       } else {
           booking := db.GetPrivateBooking(payload.BookingId)
           booking.Status = "confirmed"
           booking.ConfirmedAt = parseTime(payload.ConfirmedAt)
           db.SavePrivateBooking(booking)
       }
   }
   ```

2. **Send Confirmation to Athlete:**
   - Email/SMS confirmation with class details
   - Add to athlete's calendar
   - Provide cancellation policy reminder
   - Include facility location and parking info

3. **Update Capacity:**
   - Decrement available spots for the class
   - Update waitlist if applicable

4. **Notify Trainer:**
   - Alert trainer about new enrollment
   - Update trainer's class roster

5. **Trigger Post-Enrollment Workflows:**
   - Send pre-class reminders (24h, 1h before)
   - Add to check-in list for day of class
   - Track attendance metrics

6. **Update UI:**
   - Show "Confirmed" status on athlete's schedule
   - Update class roster in trainer/admin views
   - Refresh available spots display

7. **Financial Tracking:**
   - Record revenue from enrollment
   - Update athlete's credit/package balance

---

### 10. ENROLLMENT_CANCELLED

**Purpose:** Notifies Ground Zero OS when an enrollment is cancelled, including cancellation policy details.

**Trigger:** Athlete or admin cancels an enrollment.

**Function:** This event signals that an athlete is no longer attending a session. The cancellation includes policy details (on-time vs late, trainer-caused vs athlete-caused, refund vs credit vs no-refund). Ground Zero OS should free up the spot, process refunds/credits according to policy, and notify relevant parties.

**CalZero Implementation:**
- **Event Type:** `ENROLLMENT_CANCELLED`
- **Emitted By:** `CancelService.cancelGroupEnrollment()` and `CancelService.cancelPrivateEnrollment()`
- **Files:**
  - Group: `apps/api/v2/src/modules/enrollments/services/cancel.service.ts:124`
  - Private: `apps/api/v2/src/modules/enrollments/services/cancel.service.ts:183`
- **Trigger:** Cancellation via API

**Ground Zero OS Receives (GROUP):**

```json
{
  "type": "ENROLLMENT_CANCELLED",
  "occurredAt": "2024-12-10T17:00:00Z",
  "payload": {
    "enrollmentId": "seat-uuid-123",
    "kind": "GROUP",
    "athleteId": "athlete-456",
    "occurrenceId": "cm3occ789",
    "seriesId": "cm3series123",
    "timingTag": "on_time",
    "trainerCaused": false,
    "policyOutcome": "full_refund",
    "cancellationReason": "Schedule conflict",
    "cancelledAt": "2024-12-10T17:00:00Z"
  }
}
```

**Ground Zero OS Receives (PRIVATE):**

```json
{
  "type": "ENROLLMENT_CANCELLED",
  "occurredAt": "2024-12-10T17:05:00Z",
  "payload": {
    "enrollmentId": "booking-uuid-456",
    "kind": "PRIVATE",
    "athleteId": "athlete-789",
    "bookingId": "booking-abc-123",
    "timingTag": "late",
    "trainerCaused": false,
    "policyOutcome": "credit",
    "cancellationReason": null,
    "cancelledAt": "2024-12-10T17:05:00Z"
  }
}
```

**Payload Fields (GROUP):**
- `enrollmentId` (string) - BookingSeat UUID
- `kind` (string) - Always "GROUP"
- `athleteId` (string) - Ground Zero OS athlete identifier
- `occurrenceId` (string) - Specific class occurrence
- `seriesId` (string) - Group series identifier
- `timingTag` (string) - "on_time" (before policy deadline) or "late" (after deadline)
- `trainerCaused` (boolean) - True if trainer cancelled, false if athlete cancelled
- `policyOutcome` (string) - "full_refund", "credit", or "no_refund"
- `cancellationReason` (string or null) - Optional reason provided
- `cancelledAt` (ISO datetime) - When cancellation occurred

**Payload Fields (PRIVATE):**
- `enrollmentId` (string) - Booking UUID
- `kind` (string) - Always "PRIVATE"
- `athleteId` (string) - Ground Zero OS athlete identifier
- `bookingId` (string) - Booking identifier
- `timingTag` (string) - "on_time" or "late"
- `trainerCaused` (boolean) - True if trainer cancelled
- `policyOutcome` (string) - "full_refund", "credit", or "no_refund"
- `cancellationReason` (string or null) - Optional reason
- `cancelledAt` (ISO datetime) - When cancellation occurred

**Ground Zero OS Should:**

1. **Process Cancellation:**
   ```go
   func handleEnrollmentCancelled(payload CancellationPayload) {
       if payload.Kind == "GROUP" {
           enrollment := db.GetGroupEnrollment(payload.EnrollmentId)
           enrollment.Status = "cancelled"
           enrollment.CancelledAt = parseTime(payload.CancelledAt)
           db.SaveGroupEnrollment(enrollment)
       } else {
           booking := db.GetPrivateBooking(payload.BookingId)
           booking.Status = "cancelled"
           booking.CancelledAt = parseTime(payload.CancelledAt)
           db.SavePrivateBooking(booking)
       }

       // Free up the spot
       db.IncrementAvailableCapacity(payload.OccurrenceId)
   }
   ```

2. **Apply Cancellation Policy:**
   ```go
   switch payload.PolicyOutcome {
   case "full_refund":
       billingService.IssueRefund(payload.AthleteId, enrollment.Amount)
   case "credit":
       billingService.IssueCreditToAccount(payload.AthleteId, enrollment.Amount)
   case "no_refund":
       // No financial action needed
   }
   ```

3. **Free Up Capacity:**
   - Add spot back to available capacity
   - Notify waitlist if applicable
   - Offer spot to next person on waitlist

4. **Notify Athlete:**
   - Send cancellation confirmation
   - Explain refund/credit policy outcome
   - Confirm financial transaction (refund or credit applied)

5. **Notify Trainer (if relevant):**
   - Alert trainer about cancellation
   - Update class roster

6. **Track Metrics:**
   - Cancellation rate (on-time vs late)
   - Trainer-caused vs athlete-caused
   - Policy outcome distribution
   - Cancellation reasons (for improving retention)

7. **Update UI:**
   - Remove from athlete's schedule
   - Update class roster
   - Refresh available spots display

---

### 11. ENROLLMENT_RESCHEDULED

**Purpose:** Notifies Ground Zero OS when an enrollment is moved from one time to another.

**Trigger:** Athlete reschedules their enrollment to a different class time.

**Function:** This event signals that an athlete is changing their session time. Ground Zero OS should cancel the old enrollment, create a new enrollment, manage capacity for both slots, and notify all relevant parties. No refund/credit is typically involved - it's a simple move.

**CalZero Implementation:**
- **Event Type:** `ENROLLMENT_RESCHEDULED`
- **Emitted By:** `RescheduleService.rescheduleGroupEnrollment()` and `RescheduleService.reschedulePrivateEnrollment()`
- **Files:**
  - Group: `apps/api/v2/src/modules/enrollments/services/reschedule.service.ts:152`
  - Private: `apps/api/v2/src/modules/enrollments/services/reschedule.service.ts:239`
- **Trigger:** Reschedule via API

**Ground Zero OS Receives (GROUP):**

```json
{
  "type": "ENROLLMENT_RESCHEDULED",
  "occurredAt": "2024-12-10T17:15:00Z",
  "payload": {
    "enrollmentId": "seat-uuid-new",
    "kind": "GROUP",
    "athleteId": "athlete-456",
    "oldOccurrenceId": "cm3occ789",
    "newOccurrenceId": "cm3occ890",
    "oldStartTime": "2024-12-16T10:00:00Z",
    "newStartTime": "2024-12-17T10:00:00Z",
    "rescheduledAt": "2024-12-10T17:15:00Z"
  }
}
```

**Ground Zero OS Receives (PRIVATE):**

```json
{
  "type": "ENROLLMENT_RESCHEDULED",
  "occurredAt": "2024-12-10T17:20:00Z",
  "payload": {
    "enrollmentId": "booking-uuid-new",
    "kind": "PRIVATE",
    "athleteId": "athlete-789",
    "oldBookingId": "booking-abc-123",
    "newBookingId": "booking-abc-456",
    "oldStartTime": "2024-12-17T14:00:00Z",
    "newStartTime": "2024-12-18T15:00:00Z",
    "rescheduledAt": "2024-12-10T17:20:00Z"
  }
}
```

**Payload Fields (GROUP):**
- `enrollmentId` (string) - NEW BookingSeat UUID
- `kind` (string) - Always "GROUP"
- `athleteId` (string) - Ground Zero OS athlete identifier
- `oldOccurrenceId` (string) - Original class occurrence
- `newOccurrenceId` (string) - New class occurrence
- `oldStartTime` (ISO datetime) - Original class start time
- `newStartTime` (ISO datetime) - New class start time
- `rescheduledAt` (ISO datetime) - When reschedule occurred

**Payload Fields (PRIVATE):**
- `enrollmentId` (string) - NEW Booking UUID
- `kind` (string) - Always "PRIVATE"
- `athleteId` (string) - Ground Zero OS athlete identifier
- `oldBookingId` (string) - Original booking identifier
- `newBookingId` (string) - New booking identifier
- `oldStartTime` (ISO datetime) - Original session start time
- `newStartTime` (ISO datetime) - New session start time
- `rescheduledAt` (ISO datetime) - When reschedule occurred

**Ground Zero OS Should:**

1. **Process Reschedule:**
   ```go
   func handleEnrollmentRescheduled(payload ReschedulePayload) {
       if payload.Kind == "GROUP" {
           // Cancel old enrollment
           oldEnrollment := db.GetGroupEnrollment(payload.OldOccurrenceId, payload.AthleteId)
           oldEnrollment.Status = "rescheduled"
           db.SaveGroupEnrollment(oldEnrollment)

           // Create new enrollment
           newEnrollment := GroupEnrollment{
               EnrollmentId: payload.EnrollmentId,
               AthleteId: payload.AthleteId,
               OccurrenceId: payload.NewOccurrenceId,
               Status: "confirmed",
           }
           db.CreateGroupEnrollment(newEnrollment)

           // Update capacity
           db.IncrementAvailableCapacity(payload.OldOccurrenceId)
           db.DecrementAvailableCapacity(payload.NewOccurrenceId)
       } else {
           // Similar logic for private bookings
       }
   }
   ```

2. **Update Capacity:**
   - Free spot in old class
   - Reserve spot in new class
   - Notify waitlist for old class if applicable

3. **Notify Athlete:**
   - Send reschedule confirmation
   - Provide new class details
   - Update calendar invitation
   - Remind of cancellation policy for new class

4. **Notify Trainers:**
   - Alert trainer of old class (roster updated)
   - Alert trainer of new class (new student)

5. **Update UI:**
   - Move enrollment on athlete's schedule
   - Update both class rosters
   - Refresh available spots for both classes

6. **Track Metrics:**
   - Reschedule frequency
   - Reason for reschedule (if captured)
   - Impact on class utilization

7. **No Financial Transaction:**
   - Reschedules typically don't involve refunds/credits
   - Athlete's payment remains valid for new time

---

## Hold Management Events (Phase 4-5)

### 12. HOLD_RELEASED

**Purpose:** Notifies Ground Zero OS when a hold is released (expired or manually released).

**Trigger:** Hold expires automatically or is manually released before confirmation.

**Function:** This event signals that a tentative reservation has been cancelled. The spot is no longer reserved for the athlete. Ground Zero OS should free up the spot, notify the athlete (if expired), and make the slot available for other bookings.

**CalZero Implementation:**
- **Event Type:** `HOLD_RELEASED`
- **Emitted By:** `ReleaseService.releaseHold()`
- **File:** `apps/api/v2/src/modules/holds/services/release.service.ts:49`
- **Trigger:** Hold expiration (automatic) or manual release

**Ground Zero OS Receives:**

```json
{
  "type": "HOLD_RELEASED",
  "occurredAt": "2024-12-10T17:30:00Z",
  "payload": {
    "holdId": "hold-uuid-123",
    "athleteId": "athlete-456",
    "trainerId": 456,
    "startsAt": "2024-12-16T10:00:00Z",
    "endsAt": "2024-12-16T11:00:00Z",
    "reason": "expired",
    "releasedAt": "2024-12-10T17:30:00Z"
  }
}
```

**Payload Fields:**
- `holdId` (string) - Hold identifier
- `athleteId` (string) - Ground Zero OS athlete identifier
- `trainerId` (number) - CalZero trainer ID
- `startsAt` (ISO datetime) - Session start time
- `endsAt` (ISO datetime) - Session end time
- `reason` (string) - "expired" (automatic) or "manual" (admin/athlete released)
- `releasedAt` (ISO datetime) - When hold was released

**Ground Zero OS Should:**

1. **Release Hold:**
   ```go
   func handleHoldReleased(payload HoldReleasedPayload) {
       hold := db.GetHold(payload.HoldId)
       hold.Status = "released"
       hold.ReleasedAt = parseTime(payload.ReleasedAt)
       hold.ReleaseReason = payload.Reason
       db.SaveHold(hold)

       // Free up the spot
       if hold.Type == "group" {
           db.IncrementAvailableCapacity(hold.OccurrenceId)
       } else {
           db.MarkPrivateSlotAvailable(hold.StartTime, hold.TrainerId)
       }
   }
   ```

2. **Free Up Capacity:**
   - Add spot back to available inventory
   - Make slot bookable again

3. **Notify Athlete (if expired):**
   ```go
   if payload.Reason == "expired" {
       notification := Notification{
           Type: "hold_expired",
           Message: fmt.Sprintf(
               "Your hold for %s on %s has expired. The spot has been released.",
               sessionName,
               formatTime(payload.StartsAt),
           ),
       }
       notificationService.SendToAthlete(payload.AthleteId, notification)
   }
   ```

4. **Update Waitlist:**
   - If there's a waitlist, offer spot to next person
   - Send automatic notification to waitlist member

5. **Update UI:**
   - Remove hold indicator from athlete's pending list
   - Update available spots count
   - Show slot as available in booking interface

6. **Track Metrics:**
   - Hold expiration rate
   - Conversion rate (holds to confirmed enrollments)
   - Time to confirmation

---

## OOO & Coverage Events (Phase 8)

### 13. OOO_CREATED

**Purpose:** Notifies Ground Zero OS when a trainer creates an out-of-office entry.

**Trigger:** A trainer or admin creates a new OOO entry via `POST /ooo`.

**Function:** This event signals that a trainer will be unavailable during a specific time period. Ground Zero OS should store this information and prepare to handle coverage for affected sessions.

**CalZero Implementation:**
- **Event Type:** `OOO_CREATED`
- **Emitted By:** Legacy webhook system (existing Cal.com webhook)
- **Trigger:** `POST /ooo` endpoint

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

**Payload Fields:**
- `oooId` (number) - CalZero OOO entry ID
- `trainerId` (number) - CalZero trainer ID
- `trainerName` (string) - Trainer's name
- `trainerEmail` (string) - Trainer's email
- `start` (ISO datetime) - OOO start date
- `end` (ISO datetime) - OOO end date
- `notes` (string) - Optional notes about the OOO
- `reasonId` (number) - Reason code
- `reason` (string) - Reason text (e.g., "vacation", "sick", "travel")
- `affectedOccurrences` (number) - Count of classes affected

**Ground Zero OS Should:**

1. **Store OOO Entry:**
   ```go
   func handleOOOCreated(payload OOOCreatedPayload) {
       oooEntry := OOOEntry{
           OOOId: payload.OOOId,
           TrainerId: payload.TrainerId,
           Start: parseTime(payload.Start),
           End: parseTime(payload.End),
           Notes: payload.Notes,
           Reason: payload.Reason,
       }
       db.CreateOOOEntry(oooEntry)
   }
   ```

2. **Alert Facility Staff:**
   - Send notification to facility managers
   - Display alert: "John Smith is OOO Dec 15-20, 5 classes need coverage"

3. **Display in UI:**
   - Show OOO status on trainer's profile
   - Mark OOO period on calendar/schedule views
   - Display "Out of Office" badge

4. **Track Coverage Status:**
   - Mark OOO entry as "pending coverage assignment"
   - Wait for `COVERAGE_NEEDED` events for specific classes

5. **Prepare for Coverage Events:**
   - Next events will be `COVERAGE_NEEDED` for each affected class
   - Display coverage dashboard showing which classes need substitutes

**See Phase 8 documentation for complete details:** `docs/phase-8-webhook-integration.md`

---

### 14. COVERAGE_NEEDED

**Purpose:** Alerts Ground Zero OS that a specific session occurrence needs a substitute trainer because the assigned trainer is OOO.

**Trigger:**
- When an OOO entry is created and affects a **published** group session (immediate)
- When an **internal** session with `needsCoverage=true` becomes **published** via nightly job (delayed)

**Function:** This event means a session has enrolled athletes but no trainer. Ground Zero OS should prioritize finding coverage to avoid session cancellation.

**CalZero Implementation:**
- **Event Type:** `COVERAGE_NEEDED`
- **Emitted By:**
  - `OooOccurrenceService.flagAffectedOccurrences()` (immediate, for published sessions)
  - `OooOccurrenceService.emitCoverageEventsForPublished()` (nightly job, for newly published sessions)
- **Files:** `apps/api/v2/src/modules/ooo/services/ooo-occurrence.service.ts:81, 171`

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

**Payload Fields:**
- `occurrenceId` (string) - Occurrence UID needing coverage
- `trainerId` (number) - Original trainer ID (now OOO)
- `startTime` (ISO datetime) - Class start time
- `endTime` (ISO datetime) - Class end time
- `seriesId` (string) - Group series identifier
- `enrollmentCount` (number) - Number of athletes enrolled

**Ground Zero OS Should:**

1. **Display Alert:**
   ```go
   func handleCoverageNeeded(payload CoverageNeededPayload) {
       occurrence := db.GetOccurrence(payload.OccurrenceId)
       series := db.GetSeries(payload.SeriesId)

       alert := CoverageAlert{
           OccurrenceId: payload.OccurrenceId,
           SeriesName: series.Name,
           StartTime: parseTime(payload.StartTime),
           EnrollmentCount: payload.EnrollmentCount,
           Urgency: calculateUrgency(parseTime(payload.StartTime)),
           Status: "needs_coverage",
       }
       db.CreateCoverageAlert(alert)

       notificationService.SendToFacilityManagers(
           "Coverage Needed",
           fmt.Sprintf(
               "%s on %s needs coverage (%d athletes enrolled)",
               series.Name,
               formatDateTime(payload.StartTime),
               payload.EnrollmentCount,
           ),
       )
   }
   ```

2. **Show Session Details:**
   - Display which class needs coverage
   - Show date, time, and enrolled athlete count
   - Calculate time remaining until class

3. **Suggest Substitutes:**
   - Call CalZero API to find eligible trainers:
     ```go
     eligibility := calzeroClient.GetEligibility(payload.OccurrenceId)
     for _, trainer := range eligibility.EligibleTrainers {
         // Display trainer as potential substitute
     }
     ```

4. **Enable Assignment:**
   - Provide UI for admin to select substitute
   - Call `POST /coverage/reassign` to assign coverage

5. **Track Urgency:**
   - Prioritize classes closer to start time
   - Use color coding (red = <24h, yellow = <1 week)

6. **Notify Staff:**
   - Send push notification or email to facility managers
   - Display in coverage dashboard

**See Phase 8 documentation for complete details:** `docs/phase-8-webhook-integration.md`

---

### 15. SESSION_TRAINER_CHANGED

**Purpose:** Confirms that a session has been successfully reassigned to a substitute trainer.

**Trigger:** An admin reassigns an occurrence to a substitute trainer via `POST /coverage/reassign`.

**Function:** This event signals that coverage has been secured. Ground Zero OS should notify affected athletes and update all UIs to show the new trainer.

**CalZero Implementation:**
- **Event Type:** `SESSION_TRAINER_CHANGED`
- **Emitted By:** `OccurrenceReassignService.reassignSingleOccurrence()`
- **File:** `apps/api/v2/src/modules/coverage/services/occurrence-reassign.service.ts:132`

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

**Payload Fields:**
- `occurrenceId` (string) - Occurrence UID that was reassigned
- `fromTrainerId` (number) - Original trainer ID
- `toTrainerId` (number) - New substitute trainer ID
- `reason` (string) - Always "coverage_ooo" for coverage reassignments
- `seriesId` (string) - Group series identifier
- `eventTypeId` (number) - CalZero event type ID
- `startTime` (ISO datetime) - Class start time
- `endTime` (ISO datetime) - Class end time
- `reassignedBy` (number) - Admin user ID who performed reassignment

**Ground Zero OS Should:**

1. **Update Database:**
   ```go
   func handleSessionTrainerChanged(payload TrainerChangedPayload) {
       occurrence := db.GetOccurrence(payload.OccurrenceId)

       oldTrainer := db.GetTrainer(payload.FromTrainerId)
       newTrainer := db.GetTrainer(payload.ToTrainerId)

       occurrence.TrainerId = payload.ToTrainerId
       occurrence.ReassignedBy = payload.ReassignedBy
       occurrence.ReassignedAt = time.Now()
       db.SaveOccurrence(occurrence)

       // Clear coverage alert
       db.ClearCoverageAlert(payload.OccurrenceId)
   }
   ```

2. **Notify Athletes:**
   ```go
   enrollments := db.GetEnrollments(payload.OccurrenceId)
   for _, enrollment := range enrollments {
       notificationService.SendToAthlete(
           enrollment.AthleteId,
           "Trainer Change",
           fmt.Sprintf(
               "Your class on %s will now be taught by %s instead of %s",
               formatDateTime(payload.StartTime),
               newTrainer.Name,
               oldTrainer.Name,
           ),
       )
   }
   ```

3. **Notify Trainers:**
   - **Original trainer:** "Coverage has been secured for your Dec 16 class by [New Trainer]"
   - **Substitute trainer:** "You've been assigned to cover [Original Trainer]'s class on Dec 16 at 10am"

4. **Update UI:**
   - Refresh schedule views
   - Update class details to show new trainer
   - Update trainer profiles
   - Clear coverage alert/badge

5. **Mark Coverage Complete:**
   - Update OOO tracking: 4/5 classes covered
   - Show progress: "Coverage: 4 of 5 classes assigned"

6. **Log Activity:**
   - Record reassignment in audit trail
   - Track who assigned coverage and when

**See Phase 8 documentation for complete details:** `docs/phase-8-webhook-integration.md`

---

## Ground Zero OS Implementation Guide

### Webhook Endpoint Structure

```go
package webhooks

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "io"
    "net/http"
)

type WebhookHandler struct {
    secret string
    db     *Database
}

func (h *WebhookHandler) HandleCalZeroWebhook(w http.ResponseWriter, r *http.Request) {
    // 1. Read body
    body, err := io.ReadAll(r.Body)
    if err != nil {
        w.WriteHeader(http.StatusBadRequest)
        return
    }
    defer r.Body.Close()

    // 2. Verify signature
    signature := r.Header.Get("X-CalZero-Signature-256")
    if !h.verifySignature(body, signature) {
        w.WriteHeader(http.StatusUnauthorized)
        return
    }

    // 3. Check for duplicate (idempotency)
    eventID := r.Header.Get("X-CalZero-Event-ID")
    if h.db.EventExists(eventID) {
        // Already processed, acknowledge immediately
        w.WriteHeader(http.StatusOK)
        return
    }

    // 4. Parse payload
    var event WebhookEvent
    if err := json.Unmarshal(body, &event); err != nil {
        w.WriteHeader(http.StatusBadRequest)
        return
    }

    // 5. Store event (for idempotency check)
    h.db.StoreEventID(eventID)

    // 6. Acknowledge immediately
    w.WriteHeader(http.StatusOK)

    // 7. Process asynchronously
    go h.processEvent(event)
}

func (h *WebhookHandler) verifySignature(body []byte, signature string) bool {
    mac := hmac.New(sha256.New, []byte(h.secret))
    mac.Write(body)
    expectedSignature := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

func (h *WebhookHandler) processEvent(event WebhookEvent) {
    switch event.Type {
    case "SCHEDULE_UPDATED":
        h.handleScheduleUpdated(event.Payload)
    case "TIME_BLOCK_CREATED":
        h.handleTimeBlockCreated(event.Payload)
    case "TIME_BLOCK_DELETED":
        h.handleTimeBlockDeleted(event.Payload)
    case "GROUP_CREATED":
        h.handleGroupCreated(event.Payload)
    case "GROUP_UPDATED":
        h.handleGroupUpdated(event.Payload)
    case "SERIES_ENDED":
        h.handleSeriesEnded(event.Payload)
    case "GROUP_SOFT_CAP_REACHED":
        h.handleSoftCapReached(event.Payload)
    case "SERIES_ENROLLMENT_CREATED":
        h.handleSeriesEnrollmentCreated(event.Payload)
    case "ENROLLMENT_CONFIRMED":
        h.handleEnrollmentConfirmed(event.Payload)
    case "ENROLLMENT_CANCELLED":
        h.handleEnrollmentCancelled(event.Payload)
    case "ENROLLMENT_RESCHEDULED":
        h.handleEnrollmentRescheduled(event.Payload)
    case "HOLD_RELEASED":
        h.handleHoldReleased(event.Payload)
    case "OOO_CREATED":
        h.handleOOOCreated(event.Payload)
    case "COVERAGE_NEEDED":
        h.handleCoverageNeeded(event.Payload)
    case "SESSION_TRAINER_CHANGED":
        h.handleSessionTrainerChanged(event.Payload)
    default:
        log.Printf("Unknown event type: %s", event.Type)
    }
}
```

---

### Idempotency Implementation

```go
type EventStore struct {
    db *sql.DB
}

func (s *EventStore) EventExists(eventID string) bool {
    var count int
    s.db.QueryRow(
        "SELECT COUNT(*) FROM webhook_events WHERE event_id = ?",
        eventID,
    ).Scan(&count)
    return count > 0
}

func (s *EventStore) StoreEventID(eventID string) error {
    _, err := s.db.Exec(
        "INSERT INTO webhook_events (event_id, received_at) VALUES (?, ?)",
        eventID,
        time.Now(),
    )
    return err
}
```

**Database Schema:**
```sql
CREATE TABLE webhook_events (
    event_id VARCHAR(255) PRIMARY KEY,
    received_at TIMESTAMP NOT NULL,
    INDEX idx_received_at (received_at)
);

-- Clean up old events after 30 days
DELETE FROM webhook_events WHERE received_at < NOW() - INTERVAL 30 DAY;
```

---

### Calling CalZero APIs from Ground Zero OS

**Authentication:**
```go
type CalZeroClient struct {
    baseURL    string
    jwtPrivateKey *rsa.PrivateKey
}

func (c *CalZeroClient) generateJWT(trainerId string, isAdmin bool) (string, error) {
    claims := jwt.MapClaims{
        "sub": "ops-user-123",
        "trainerId": trainerId,
        "isAdmin": isAdmin,
        "aud": "calzero",
        "iat": time.Now().Unix(),
        "exp": time.Now().Add(5 * time.Minute).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
    return token.SignedString(c.jwtPrivateKey)
}

func (c *CalZeroClient) GetEligibility(occurrenceIds []string) (*EligibilityResponse, error) {
    token, err := c.generateJWT("", true) // Admin token
    if err != nil {
        return nil, err
    }

    payload := map[string]interface{}{
        "occurrenceIds": occurrenceIds,
    }

    body, _ := json.Marshal(payload)
    req, _ := http.NewRequest("POST", c.baseURL+"/coverage/eligibility", bytes.NewReader(body))
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result EligibilityResponse
    json.NewDecoder(resp.Body).Decode(&result)
    return &result, nil
}

func (c *CalZeroClient) ReassignCoverage(assignments []Assignment) (*ReassignResponse, error) {
    token, err := c.generateJWT("", true) // Admin token
    if err != nil {
        return nil, err
    }

    payload := map[string]interface{}{
        "assignments": assignments,
    }

    body, _ := json.Marshal(payload)
    req, _ := http.NewRequest("POST", c.baseURL+"/coverage/reassign", bytes.NewReader(body))
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result ReassignResponse
    json.NewDecoder(resp.Body).Decode(&result)
    return &result, nil
}
```

---

## Testing & Troubleshooting

### Testing Webhook Delivery

**1. Create a Test Webhook Receiver:**

```bash
# Using requestbin or webhook.site
curl -X POST https://webhook.site/unique-id \
  -H "Content-Type: application/json" \
  -d '{"test": "webhook"}'
```

**2. Configure CalZero:**

```env
WEBHOOK_URL=https://webhook.site/your-unique-id
WEBHOOK_SECRET=your-secret-key
```

**3. Trigger Events:**

```bash
# Create OOO entry
curl -X POST http://localhost:3000/v2/ooo \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "start": "2024-12-15T00:00:00Z",
    "end": "2024-12-20T23:59:59Z",
    "reasonId": 2
  }'

# Check outbox events
SELECT * FROM "OutboxEvent"
WHERE type = 'COVERAGE_NEEDED'
ORDER BY "occurredAt" DESC;
```

### Debugging Webhook Failures

**Check Outbox Status:**

```sql
-- Find failed events
SELECT "eventId", type, attempts, "nextAttemptAt", error
FROM "OutboxEvent"
WHERE status = 'failed'
ORDER BY "occurredAt" DESC;

-- Find pending events with retries
SELECT "eventId", type, attempts, "nextAttemptAt"
FROM "OutboxEvent"
WHERE status = 'pending' AND attempts > 0
ORDER BY "nextAttemptAt" ASC;
```

**Check CalZero Logs:**

```bash
# Docker logs
docker logs calzero-api --tail=100 --follow

# Search for outbox worker logs
grep "OutboxWorkerService" logs/calzero.log
```

**Common Issues:**

1. **Webhooks Not Delivered:**
   - Check `WEBHOOK_URL` is configured
   - Verify Ground Zero OS is reachable from CalZero
   - Check firewall rules

2. **Signature Verification Fails:**
   - Ensure `WEBHOOK_SECRET` matches on both sides
   - Verify HMAC implementation matches

3. **Duplicate Events:**
   - Check idempotency implementation
   - Verify event IDs are being stored

4. **Events Stuck in Pending:**
   - Check OutboxWorkerService is running
   - Verify polling interval
   - Check for errors in logs

### Manual Retry

```sql
-- Reset failed event for retry
UPDATE "OutboxEvent"
SET status = 'pending',
    attempts = 0,
    "nextAttemptAt" = NOW()
WHERE "eventId" = '<event-id>';
```

---

## Configuration Reference

### CalZero Environment Variables

```env
# Ops Integration
OPS_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
WEBHOOK_URL="https://groundzero.example.com/webhooks/calzero"
WEBHOOK_SECRET="your-webhook-secret-key"

# Outbox Worker
OUTBOX_POLL_INTERVAL_MS=30000      # Poll every 30 seconds
OUTBOX_BATCH_SIZE=50               # Process up to 50 events per batch
OUTBOX_MAX_RETRY_HOURS=72          # Give up after 72 hours
```

### Ground Zero OS Environment Variables

```env
# CalZero API
CALZERO_API_URL="https://api.calzero.example.com"
CALZERO_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
CALZERO_WEBHOOK_SECRET="your-webhook-secret-key"

# Webhook Endpoint
WEBHOOK_PORT=8080
WEBHOOK_PATH="/webhooks/calzero"
```

---

## Event Summary Table

| Event | Phase | Trigger | Critical Data | Ground Zero Action |
|-------|-------|---------|---------------|-------------------|
| SCHEDULE_UPDATED | 1-2 | Schedule change | trainerId, workingHours | Update availability, check conflicts |
| TIME_BLOCK_CREATED | 1-2 | Block time | trainerId, startTime, endTime | Block time slot, prevent bookings |
| TIME_BLOCK_DELETED | 1-2 | Unblock time | trainerId, timeBlockId | Restore availability |
| GROUP_CREATED | 2-3 | New series | seriesId, name, schedule | Create series, enable enrollment |
| GROUP_UPDATED | 2-3 | Series edit | seriesId, effectiveDate, changes | Update series, notify athletes |
| SERIES_ENDED | 2-3 | End series | seriesId, endDate | Cancel future classes, refund |
| GROUP_SOFT_CAP_REACHED | 2-3 | Enrollment threshold | occurrenceId, currentSeats | Alert staff, show "filling up" |
| SERIES_ENROLLMENT_CREATED | 2-3 | Series enrollment | enrollmentId, seriesId, athleteId | Reserve all occurrences |
| ENROLLMENT_CONFIRMED | 3-4 | Hold confirmed | enrollmentId, kind, athleteId | Finalize booking, send confirmation |
| ENROLLMENT_CANCELLED | 3-4 | Cancellation | enrollmentId, policyOutcome | Process refund/credit, free spot |
| ENROLLMENT_RESCHEDULED | 3-4 | Reschedule | oldOccurrenceId, newOccurrenceId | Move enrollment, update capacity |
| HOLD_RELEASED | 4-5 | Hold expires | holdId, reason | Free spot, notify athlete |
| OOO_CREATED | 8 | OOO created | trainerId, start, end | Store OOO, alert staff |
| COVERAGE_NEEDED | 8 | Published occurrence needs coverage | occurrenceId, enrollmentCount | Find substitute, display alert |
| SESSION_TRAINER_CHANGED | 8 | Coverage assigned | occurrenceId, fromTrainerId, toTrainerId | Notify athletes, update roster |

---

## Summary

This guide documents **all 15 webhook events** that CalZero sends to Ground Zero OS across all implementation phases. Each event includes:

- ✅ Natural language explanation of purpose and function
- ✅ CalZero implementation details (file, line, trigger)
- ✅ Complete payload structure with field descriptions
- ✅ Ground Zero OS responsibilities and action items
- ✅ Go code examples for handling each event
- ✅ Database schema, testing procedures, and configuration

**Key Points:**

1. **Reliable Delivery:** Outbox pattern with 72-hour retry window
2. **Security:** HMAC-SHA256 signature verification
3. **Idempotency:** Ground Zero OS must handle duplicate events
4. **Bi-Directional:** CalZero sends webhooks + Ground Zero OS calls REST APIs
5. **Asynchronous Processing:** Acknowledge immediately, process in background

For detailed Phase 8 (OOO & Coverage) documentation, see: `docs/phase-8-webhook-integration.md`
