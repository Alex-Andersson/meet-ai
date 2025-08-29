// Database-based AI connection tracking to prevent duplicate connections
// This ensures atomic operations and works across serverless function instances

import { db } from "@/db";
import { aiConnectionLocks } from "@/db/schema";
import { eq, lt } from "drizzle-orm";

interface AIConnectionState {
    meetingId: string;
    agentId: string;
    isInProgress: boolean;
    createdAt: Date;
}

// Check if there's an existing connection for a meeting
export const getConnectionState = async (meetingId: string): Promise<AIConnectionState | null> => {
    try {
        const [existing] = await db
            .select()
            .from(aiConnectionLocks)
            .where(eq(aiConnectionLocks.meetingId, meetingId))
            .limit(1);
        
        if (!existing) return null;
        
        return {
            meetingId: existing.meetingId,
            agentId: existing.agentId,
            isInProgress: existing.isInProgress,
            createdAt: existing.createdAt
        };
    } catch (error) {
        console.error('Error checking connection state:', error);
        return null;
    }
};

// Atomically mark a connection as in progress (prevents duplicates)
export const markConnectionInProgress = async (meetingId: string, agentId: string): Promise<boolean> => {
    try {
        console.log('Attempting to mark AI connection as IN PROGRESS for meeting:', meetingId);
        
        // Try to insert a new lock record - this will fail if one already exists (primary key constraint)
        const result = await db
            .insert(aiConnectionLocks)
            .values({
                meetingId,
                agentId,
                isInProgress: true,
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .returning();
        
        if (result.length > 0) {
            console.log('Successfully marked AI connection as IN PROGRESS for meeting:', meetingId);
            return true;
        }
        
        return false;
    } catch (error) {
        console.log('Failed to mark connection in progress (likely duplicate):', error);
        return false;
    }
};

// Mark a connection as completed
export const markConnectionCompleted = async (meetingId: string): Promise<void> => {
    try {
        await db
            .update(aiConnectionLocks)
            .set({
                isInProgress: false,
                updatedAt: new Date()
            })
            .where(eq(aiConnectionLocks.meetingId, meetingId));
        
        console.log('Marked AI connection as COMPLETED for meeting:', meetingId);
    } catch (error) {
        console.error('Error marking connection as completed:', error);
    }
};

// Clean up connection tracking for a meeting
export const cleanupConnection = async (meetingId: string): Promise<void> => {
    try {
        await db
            .delete(aiConnectionLocks)
            .where(eq(aiConnectionLocks.meetingId, meetingId));
        
        console.log('Cleaned up AI connection tracking for meeting:', meetingId);
    } catch (error) {
        console.error('Error cleaning up connection:', error);
    }
};

// Clean up old connections (older than 5 minutes)
export const cleanupOldConnections = async (): Promise<void> => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
        
        const deleted = await db
            .delete(aiConnectionLocks)
            .where(lt(aiConnectionLocks.createdAt, fiveMinutesAgo))
            .returning();
        
        if (deleted.length > 0) {
            console.log(`Cleaned up ${deleted.length} old AI connection locks`);
        }
    } catch (error) {
        console.error('Error cleaning up old connections:', error);
    }
};

// Legacy exports for compatibility (now no-ops since we use database)
export const globalAIConnections = new Map();
export const cleanup = () => {};

// Run cleanup periodically in development
if (process.env.NODE_ENV === 'development') {
    setInterval(cleanupOldConnections, 5 * 60 * 1000); // Every 5 minutes
}
