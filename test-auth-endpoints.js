/**
 * Test script for all auth endpoints
 * Run: node test-auth-endpoints.js
 */

const API_BASE = 'http://localhost:3001';

async function testEndpoint(name, method, path, body = null, headers = {}) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    console.log(`\n🔍 Testing ${name}...`);
    console.log(`   ${method} ${API_BASE}${path}`);
    if (body) {
      console.log(`   Body:`, JSON.stringify(body, null, 2));
    }
    
    const response = await fetch(`${API_BASE}${path}`, options);
    const responseText = await response.text();
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText;
    }
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Response:`, JSON.stringify(responseData, null, 2));
    
    if (response.ok) {
      console.log(`   ✅ ${name} - SUCCESS`);
      return { success: true, status: response.status, data: responseData };
    } else {
      console.log(`   ❌ ${name} - FAILED`);
      return { success: false, status: response.status, data: responseData };
    }
  } catch (error) {
    console.log(`   ❌ ${name} - ERROR: ${error.message}`);
    console.log(`   Error details:`, error);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Starting Auth Endpoints Tests\n');
  console.log('=' .repeat(60));
  
  // Test 1: Health check
  await testEndpoint('Health Check', 'GET', '/auth/health');
  
  // Test 2: Register endpoint
  const testEmail = `test_${Date.now()}@example.com`;
  const registerResult = await testEndpoint('Register', 'POST', '/auth/register', {
    email: testEmail,
    password: 'Test123456!',
    name: 'Test User',
    company: 'Test Company'
  });
  
  // Test 3: Login endpoint
  if (registerResult.success) {
    await testEndpoint('Login', 'POST', '/auth/login', {
      email: testEmail,
      password: 'Test123456!'
    });
  }
  
  // Test 4: Login with wrong password
  await testEndpoint('Login (Wrong Password)', 'POST', '/auth/login', {
    email: testEmail,
    password: 'WrongPassword123!'
  });
  
  // Test 5: Forgot password
  await testEndpoint('Forgot Password', 'POST', '/auth/forgot-password', {
    email: testEmail
  });
  
  // Test 6: Google OAuth endpoint (should redirect)
  try {
    console.log(`\n🔍 Testing Google OAuth...`);
    console.log(`   GET ${API_BASE}/auth/google`);
    const response = await fetch(`${API_BASE}/auth/google`, {
      method: 'GET',
      redirect: 'manual'
    });
    console.log(`   Status: ${response.status} ${response.statusText}`);
    if (response.status === 302 || response.status === 307) {
      console.log(`   ✅ Google OAuth - Redirecting (expected)`);
      console.log(`   Location: ${response.headers.get('location')}`);
    } else {
      console.log(`   ⚠️  Google OAuth - Unexpected status`);
    }
  } catch (error) {
    console.log(`   ❌ Google OAuth - ERROR: ${error.message}`);
  }
  
  // Test 7: Login with non-existent user
  await testEndpoint('Login (Non-existent User)', 'POST', '/auth/login', {
    email: 'nonexistent@example.com',
    password: 'Test123456!'
  });
  
  // Test 8: Register with existing email (should fail)
  if (registerResult.success) {
    await testEndpoint('Register (Duplicate Email)', 'POST', '/auth/register', {
      email: testEmail,
      password: 'Test123456!',
      name: 'Another User'
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Tests completed!');
}

// Check if server is running first
fetch(`${API_BASE}/auth/health`)
  .then(response => {
    if (response.ok) {
      console.log('✅ Server is running!\n');
      runTests();
    } else {
      console.log('❌ Server responded with error status');
      process.exit(1);
    }
  })
  .catch(error => {
    console.log('❌ Cannot connect to server!');
    console.log(`   Error: ${error.message}`);
    console.log(`   Make sure the backend server is running on ${API_BASE}`);
    console.log(`   Run: cd backend && npm run start:dev`);
    process.exit(1);
  });

