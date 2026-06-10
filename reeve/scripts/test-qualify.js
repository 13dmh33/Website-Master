require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const qualifier = require('../lib/qualifier');

// ─── Test scenarios ───────────────────────────────────────────────────────────

const scenarios = [
  {
    label: 'High fit',
    answers: {
      paid_talks_count: '8 paid keynotes',
      fee_range: '$7,500',
      topic: 'Leadership and organizational resilience for mid-market manufacturing companies'
    }
  },
  {
    label: 'Mid fit',
    answers: {
      paid_talks_count: '3 paid talks',
      fee_range: '$3,000',
      topic: 'General motivation and mindset'
    }
  },
  {
    label: 'Low fit',
    answers: {
      paid_talks_count: '0 paid talks — I mostly speak for free at local events',
      fee_range: 'No fee yet, I\'m still building my profile',
      topic: 'Various topics — personal development, business, health'
    }
  }
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== Reeve Qualification Test ===\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set. Add it to reeve/.env and retry.\n');
    process.exit(1);
  }

  for (let i = 0; i < scenarios.length; i++) {
    const { label, answers } = scenarios[i];

    console.log(`─── Scenario ${i + 1}: ${label} ───`);
    console.log('Answers:');
    console.log(`  Paid talks : ${answers.paid_talks_count}`);
    console.log(`  Fee range  : ${answers.fee_range}`);
    console.log(`  Topic      : ${answers.topic}`);
    console.log('Scoring...');

    try {
      const result = await qualifier.scoreConversation(answers);
      console.log(`  Score      : ${result.score.toUpperCase()}`);
      console.log(`  Reasoning  : ${result.reasoning}`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }

    console.log('');
  }

  console.log('Done.');
}

runTests();
