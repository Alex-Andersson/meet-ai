// Emergency global singleton to prevent multiple AI connections
class EmergencyAIGuard {
  private static activeConnections = new Set<string>();
  private static connectionAttempts = new Map<string, number>();
  
  static isConnectionActive(meetingId: string): boolean {
    return this.activeConnections.has(meetingId);
  }
  
  static attemptConnection(meetingId: string): boolean {
    if (this.activeConnections.has(meetingId)) {
      console.log('🚨 EMERGENCY GUARD: Connection already active for meeting:', meetingId);
      return false;
    }
    
    // Check if too many attempts in short time
    const now = Date.now();
    const lastAttempt = this.connectionAttempts.get(meetingId) || 0;
    
    if (now - lastAttempt < 10000) { // 10 second minimum between attempts
      console.log('🚨 EMERGENCY GUARD: Too many attempts for meeting:', meetingId);
      return false;
    }
    
    this.activeConnections.add(meetingId);
    this.connectionAttempts.set(meetingId, now);
    console.log('✅ EMERGENCY GUARD: Connection allowed for meeting:', meetingId);
    return true;
  }
  
  static releaseConnection(meetingId: string): void {
    this.activeConnections.delete(meetingId);
    console.log('🔓 EMERGENCY GUARD: Connection released for meeting:', meetingId);
  }
  
  static forceCleanup(meetingId: string): void {
    this.activeConnections.delete(meetingId);
    this.connectionAttempts.delete(meetingId);
    console.log('🧹 EMERGENCY GUARD: Force cleanup for meeting:', meetingId);
  }
  
  static getActiveConnections(): string[] {
    return Array.from(this.activeConnections);
  }
}

export { EmergencyAIGuard };
