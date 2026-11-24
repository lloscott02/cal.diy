import { Injectable } from "@nestjs/common";

/**
 * PublishWindowService
 *
 * Determines which group session occurrences are visible to clients.
 *
 * Rules:
 * - Current week (Mon-Sun) is always published
 * - Next week is published starting Friday at 00:00
 * - All dates calculated in America/Chicago timezone
 */
@Injectable()
export class PublishWindowService {
  private readonly facilityTimezone = "America/Chicago";

  /**
   * Check if a date is within the publish window
   *
   * @param date - The date to check (can be Date or ISO string)
   * @returns true if the date should be published to clients
   */
  isInWindow(date: Date | string): boolean {
    const checkDate = typeof date === "string" ? new Date(date) : date;
    const now = this.getNowInFacilityTz();

    // Get the start of current week (Monday 00:00)
    const currentWeekStart = this.getWeekStart(now);

    // Get the start of next week (Monday 00:00)
    const nextWeekStart = new Date(currentWeekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);

    // Get the end of next week (Sunday 23:59:59)
    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);
    nextWeekEnd.setMilliseconds(-1); // End of Sunday

    // Current week is always visible
    if (checkDate >= currentWeekStart && checkDate < nextWeekStart) {
      return true;
    }

    // Next week is visible from Friday 00:00
    if (checkDate >= nextWeekStart && checkDate < nextWeekEnd) {
      // Check if today is Friday or later
      const dayOfWeek = now.getDay(); // 0=Sunday, 5=Friday
      const isFridayOrLater = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;
      return isFridayOrLater;
    }

    // Everything else is not in the window
    return false;
  }

  /**
   * Get the current time in facility timezone
   */
  private getNowInFacilityTz(): Date {
    // Convert current time to facility timezone
    const nowUtc = new Date();
    const facilityTime = new Date(nowUtc.toLocaleString("en-US", { timeZone: this.facilityTimezone }));
    return facilityTime;
  }

  /**
   * Get the start of the week (Monday 00:00) for a given date
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Get the end of the week (Sunday 23:59:59) for a given date
   */
  private getWeekEnd(date: Date): Date {
    const weekStart = this.getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setMilliseconds(-1);
    return weekEnd;
  }

  /**
   * Get the date range for the current publish window
   * Returns { start, end } in facility timezone
   */
  getPublishWindow(): { start: Date; end: Date } {
    const now = this.getNowInFacilityTz();
    const currentWeekStart = this.getWeekStart(now);

    // Always includes current week
    let windowEnd: Date;

    const dayOfWeek = now.getDay();
    const isFridayOrLater = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;

    if (isFridayOrLater) {
      // Include next week too
      const nextWeekStart = new Date(currentWeekStart);
      nextWeekStart.setDate(nextWeekStart.getDate() + 7);
      windowEnd = this.getWeekEnd(nextWeekStart);
    } else {
      // Just current week
      windowEnd = this.getWeekEnd(currentWeekStart);
    }

    return {
      start: currentWeekStart,
      end: windowEnd,
    };
  }

  /**
   * Calculate publish state for a given date
   *
   * @param date - The date to check
   * @returns "published" if in window, "internal" otherwise
   */
  getPublishState(date: Date | string): "published" | "internal" {
    return this.isInWindow(date) ? "published" : "internal";
  }
}
