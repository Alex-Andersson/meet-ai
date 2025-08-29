// Global tracking to prevent duplicate AI connections across all processes
// This shared module ensures consistent tracking between webhook and procedures

interface AIConnectionState {
    timestamp: number;
    agentId: string;
    inProgress: boolean;
}

export const globalAIConnections = new Map<string, AIConnectionState>();

// Clean up old connections every 2 minutes
const cleanupInterval = setInterval(() => {
    const twoMinutesAgo = Date.now() - (2 * 60 * 1000);
    for (const [meetingId, connection] of globalAIConnections.entries()) {
        if (connection.timestamp < twoMinutesAgo) {
            globalAIConnections.delete(meetingId);
            console.log('Cleaned up old global AI connection tracking for meeting:', meetingId);
        }
    }
}, 2 * 60 * 1000);

// Cleanup function for graceful shutdown
export const cleanup = () => {
    clearInterval(cleanupInterval);
    globalAIConnections.clear();
};

export const markConnectionInProgress = (meetingId: string, agentId: string) => {
    globalAIConnections.set(meetingId, {
        timestamp: Date.now(),
        agentId,
        inProgress: true
    });
    console.log('Marked AI connection as IN PROGRESS for meeting:', meetingId);
};

export const markConnectionCompleted = (meetingId: string, agentId: string) => {
    globalAIConnections.set(meetingId, {
        timestamp: Date.now(),
        agentId,
        inProgress: false
    });
    console.log('Marked AI connection as COMPLETED for meeting:', meetingId);
};

export const cleanupConnection = (meetingId: string) => {
    globalAIConnections.delete(meetingId);
    console.log('Cleaned up AI connection tracking for meeting:', meetingId);
};

export const getConnectionState = (meetingId: string): AIConnectionState | undefined => {
    return globalAIConnections.get(meetingId);
};
