// Copy and paste this into your browser console while on the video call page
// This will test the triggerAI function directly in the browser

console.log('=== BROWSER TRIGGER AI TEST ===');

// Get the meeting ID from the URL
const meetingId = window.location.pathname.split('/').pop();
console.log('Meeting ID from URL:', meetingId);

// Test if we can call the triggerAI function
async function testBrowserTriggerAI() {
    try {
        console.log('Attempting to call triggerAI...');
        
        // This should work if you're logged in and on the call page
        const response = await fetch('/api/trpc/meetings.triggerAI', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                json: {
                    meetingId: meetingId
                }
            })
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);

        if (response.ok) {
            console.log('✅ TriggerAI successful! AI should be joining...');
        } else {
            console.log('❌ TriggerAI failed:', data);
        }
    } catch (error) {
        console.error('❌ Error calling triggerAI:', error);
    }
}

// Also test if the React mutation hook is available
if (typeof window !== 'undefined' && window.React) {
    console.log('React is available');
    console.log('Check if you can see the Join AI button on the page');
} else {
    console.log('React not found in global scope');
}

// Run the test
testBrowserTriggerAI();
