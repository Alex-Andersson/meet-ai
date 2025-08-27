// Test ngrok webhook endpoint
const https = require('https');

async function testNgrokWebhook() {
    console.log('Testing ngrok webhook endpoint...');
    
    const options = {
        hostname: 'sawfly-daring-virtually.ngrok-free.app',
        port: 443,
        path: '/api/webhook',
        method: 'GET',
        headers: {
            'ngrok-skip-browser-warning': 'true'
        }
    };
    
    const req = https.request(options, (res) => {
        console.log(`Status: ${res.statusCode}`);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('Response:', data);
            if (res.statusCode === 200) {
                console.log('✅ Webhook endpoint is accessible via ngrok!');
            } else {
                console.log('❌ Webhook endpoint has issues');
            }
        });
    });
    
    req.on('error', (error) => {
        console.error('❌ Error:', error.message);
    });
    
    req.end();
}

testNgrokWebhook();
