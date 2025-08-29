// ABSOLUTE GLOBAL LOCK - Last resort protection
class AbsoluteAILock {
  private static globalLock = new Set<string>();
  private static requestCounts = new Map<string, number>();
  
  static tryLock(meetingId: string): boolean {
    // Check if already locked
    if (this.globalLock.has(meetingId)) {
      console.log('🔒 ABSOLUTE LOCK: Meeting already locked globally:', meetingId);
      return false;
    }
    
    // Track request count
    const currentCount = this.requestCounts.get(meetingId) || 0;
    this.requestCounts.set(meetingId, currentCount + 1);
    
    if (currentCount > 0) {
      console.log('🔒 ABSOLUTE LOCK: Multiple requests detected for meeting:', meetingId, 'count:', currentCount + 1);
      return false;
    }
    
    // Acquire lock
    this.globalLock.add(meetingId);
    console.log('🔒 ABSOLUTE LOCK: Acquired for meeting:', meetingId);
    return true;
  }
  
  static release(meetingId: string): void {
    this.globalLock.delete(meetingId);
    this.requestCounts.delete(meetingId);
    console.log('🔓 ABSOLUTE LOCK: Released for meeting:', meetingId);
  }
  
  static isLocked(meetingId: string): boolean {
    return this.globalLock.has(meetingId);
  }
  
  static getStats(): { locks: string[], requestCounts: Record<string, number> } {
    return {
      locks: Array.from(this.globalLock),
      requestCounts: Object.fromEntries(this.requestCounts)
    };
  }
  
  static forceReset(): void {
    this.globalLock.clear();
    this.requestCounts.clear();
    console.log('🚨 ABSOLUTE LOCK: Force reset all locks');
  }
}

export { AbsoluteAILock };
