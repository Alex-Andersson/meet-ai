// Test file to verify Zod and Polar integration
import { z } from 'zod';
import { polarClient } from './src/lib/polar';

console.log('Zod version:', z.version);
console.log('Polar client:', polarClient ? '✅ Available' : '❌ Not available');

export {};
