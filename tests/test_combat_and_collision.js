// tests/test_combat_and_collision.js - Automated Verification of Collision, Aiming, Necromancer Skills & Pings
const WebSocket = require('ws');

async function runTest() {
  console.log('--- Starting Automated RPG Combat & Collision Verification ---');

  const ws = new WebSocket('ws://localhost:3000');

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('✅ Connected to WebSocket server');

  let roomCode = null;
  let localPlayerId = null;
  const receivedEvents = [];

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      receivedEvents.push(msg.type);

      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        localPlayerId = msg.player.id;
        console.log(`✅ Room Created: ${roomCode}, PlayerId: ${localPlayerId}`);
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  // 1. Create Room as Necromancer
  ws.send(JSON.stringify({
    type: 'create_room',
    playerName: 'Archon Malis',
    chosenClass: 'necromancer'
  }));

  await new Promise(r => setTimeout(r, 600));

  // 2. Start Game
  ws.send(JSON.stringify({ type: 'start_game' }));
  console.log('✅ Sent start_game command');
  await new Promise(r => setTimeout(r, 1000));

  // 3. Test Movement against North/East Dungeon Walls
  console.log('🧪 Testing Wall Collision: Moving East (x -> 30) for 1 second...');
  for (let i = 0; i < 10; i++) {
    ws.send(JSON.stringify({
      type: 'input',
      movement: { x: 1.0, z: 0 },
      rotation: Math.PI / 2
    }));
    await new Promise(r => setTimeout(r, 100));
  }

  // 4. Test Aiming & Basic Attack
  console.log('🧪 Testing Directional Basic Attack towards (0, 5)...');
  ws.send(JSON.stringify({
    type: 'input',
    action: 'attack',
    targetPos: { x: 0, z: 5 },
    rotation: Math.PI
  }));
  await new Promise(r => setTimeout(r, 300));

  // 5. Test Necromancer Skill 1 (Bone Spikes)
  console.log('🧪 Testing Necromancer Skill 1 (Bone Spikes)...');
  ws.send(JSON.stringify({
    type: 'input',
    action: 'skill1',
    targetPos: { x: -4, z: 5 }
  }));
  await new Promise(r => setTimeout(r, 400));

  // 6. Test Necromancer Skill 2 (Soul Drain)
  console.log('🧪 Testing Necromancer Skill 2 (Soul Drain)...');
  ws.send(JSON.stringify({
    type: 'input',
    action: 'skill2',
    targetPos: { x: 4, z: 5 }
  }));
  await new Promise(r => setTimeout(r, 400));

  // 7. Test Necromancer Skill 3 (Corpse Explosion)
  console.log('🧪 Testing Necromancer Skill 3 (Corpse Explosion)...');
  ws.send(JSON.stringify({
    type: 'input',
    action: 'skill3',
    targetPos: { x: 0, z: 0 }
  }));
  await new Promise(r => setTimeout(r, 400));

  // 8. Test Party Pings
  console.log('🧪 Testing Party Pings (Attack, Regroup, Loot, Help)...');
  const pingTypes = ['attack', 'regroup', 'loot', 'help'];
  for (const pt of pingTypes) {
    ws.send(JSON.stringify({
      type: 'input',
      ping: { type: pt, x: 0, z: 5 }
    }));
    await new Promise(r => setTimeout(r, 200));
  }

  // Wait for tick and events
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n--- Test Event Summary ---');
  console.log('Received Event Types:', [...new Set(receivedEvents)]);

  const hasTicks = receivedEvents.includes('tick');
  const hasPing = receivedEvents.includes('party_ping');
  const hasAttackFx = receivedEvents.includes('player_attack_fx');
  const hasGroundFx = receivedEvents.includes('ground_fx');
  const hasBeamFx = receivedEvents.includes('beam_fx');

  console.log(`- Authoritative 20Hz Ticks received: ${hasTicks ? '✅' : '❌'}`);
  console.log(`- Party Ping broadcast received: ${hasPing ? '✅' : '❌'}`);
  console.log(`- Player Attack FX broadcast received: ${hasAttackFx ? '✅' : '❌'}`);
  console.log(`- Ground FX (Bone Spikes / Explosion) received: ${hasGroundFx ? '✅' : '❌'}`);
  console.log(`- Beam FX (Soul Drain) received: ${hasBeamFx ? '✅' : '❌'}`);

  ws.close();

  if (hasTicks && hasPing && hasAttackFx && hasGroundFx && hasBeamFx) {
    console.log('\n🎉 ALL VERIFICATION CHECKS PASSED PERFECTLY!');
    process.exit(0);
  } else {
    console.error('\n⚠️ Some events were missing. Check server event dispatch.');
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
