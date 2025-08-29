import { db } from "@/db";
import { aiConnectionLocks } from "@/db/schema";
import { eq } from "drizzle-orm";

// Global singleton guard to ensure only one AI per meeting
export class AISingletonGuard {
  private static instances = new Map<string, boolean>();
  
  static async checkAndLock(meetingId: string, agentId: string): Promise<boolean> {
    // Check in-memory first
    if (this.instances.has(meetingId)) {
      console.log('AI Singleton Guard: Meeting already has AI instance (in-memory check)');
      return false;
    }
    
    // Check database
    try {
      const existing = await db
        .select()
        .from(aiConnectionLocks)
        .where(eq(aiConnectionLocks.meetingId, meetingId))
        .limit(1);
      
      if (existing.length > 0) {
        console.log('AI Singleton Guard: Meeting already has AI instance (database check)');
        return false;
      }
      
      // Try to acquire lock
      await db.insert(aiConnectionLocks).values({
        meetingId,
        agentId,
        isInProgress: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // Mark in memory
      this.instances.set(meetingId, true);
      console.log('AI Singleton Guard: Lock acquired successfully');
      return true;
      
    } catch (error) {
      console.log('AI Singleton Guard: Failed to acquire lock:', error);
      return false;
    }
  }
  
  static async release(meetingId: string): Promise<void> {
    // Remove from memory
    this.instances.delete(meetingId);
    
    // Remove from database
    try {
      await db
        .delete(aiConnectionLocks)
        .where(eq(aiConnectionLocks.meetingId, meetingId));
      console.log('AI Singleton Guard: Lock released for meeting:', meetingId);
    } catch (error) {
      console.error('AI Singleton Guard: Error releasing lock:', error);
    }
  }
  
  static async cleanup(meetingId: string): Promise<void> {
    // Force cleanup regardless of state
    this.instances.delete(meetingId);
    try {
      await db
        .delete(aiConnectionLocks)
        .where(eq(aiConnectionLocks.meetingId, meetingId));
      console.log('AI Singleton Guard: Force cleanup completed for meeting:', meetingId);
    } catch (error) {
      console.error('AI Singleton Guard: Error during cleanup:', error);
    }
  }
  
  static isLocked(meetingId: string): boolean {
    return this.instances.has(meetingId);
  }
}
