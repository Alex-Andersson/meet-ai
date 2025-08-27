// Test script to directly call your webhook endpoint locally
const https = require('https');
const http = require('http');

// Test webhook endpoint locally
async function testLocalWebhook() {
    console.log('Testing local webhook endpoint...');
    
    const testPayload = {
        type: "call.session_started",
        call: {
            custom: {
                meetingId: "test-meeting-id"
            }
        }
    };
    
    const postData = JSON.stringify(testPayload);
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/webhook',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'x-signature': 'test-signature',
            'x-api-key': 'test-api-key'
        }
    };
    
    const req = http.request(options, (res) => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Headers: ${JSON.stringify(res.headers)}`);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('Response:', data);
        });
    });
    
    req.on('error', (error) => {
        console.error('Error:', error);
    });
    
    req.write(postData);
    req.end();
}

// Test the GET endpoint
async function testGetEndpoint() {
    console.log('Testing GET endpoint...');
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/webhook',
        method: 'GET'
    };
    
    const req = http.request(options, (res) => {
        console.log(`GET Status: ${res.statusCode}`);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('GET Response:', data);
        });
    });
    
    req.on('error', (error) => {
        console.error('GET Error:', error);
    });
    
    req.end();
}

// Run tests
console.log('Starting webhook tests...');
testGetEndpoint();
setTimeout(() => {
    testLocalWebhook();
}, 1000);
