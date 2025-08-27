// Direct test of triggerAI procedure
// Run this with: node test-trigger-ai.js

console.log('Testing triggerAI procedure directly...');

// Use the meeting ID from your terminal logs
const TEST_MEETING_ID = 'NihTqK99VGcawPX1mOSSR'; // From your logs: GET /call/NihTqK99VGcawPX1mOSSR

async function testTriggerAI() {
    try {
        console.log('Testing triggerAI with meeting ID:', TEST_MEETING_ID);
        
        const response = await fetch('http://localhost:3000/api/trpc/meetings.triggerAI', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                json: {
                    meetingId: TEST_MEETING_ID
                }
            })
        });

        console.log('Response status:', response.status);
        const data = await response.text();
        console.log('Response data:', data);

        if (response.ok) {
            console.log('✅ TriggerAI call successful!');
        } else {
            console.log('❌ TriggerAI call failed');
        }
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testTriggerAI();
