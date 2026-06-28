import 'dotenv/config';

const SEQ_BASE_URL = process.env.SEQ_BASE_URL || 'http://localhost:8080';
const SEQ_API_KEY = process.env.SEQ_API_KEY || '';

async function makeSeqRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${SEQ_BASE_URL}${endpoint}`);

  // Add additional query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Seq-ApiKey': SEQ_API_KEY
  };

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    throw new Error(`SEQ API error: ${response.statusText} (${response.status})`);
  }

  return response.json();
}

// Helper function to format message template tokens
function formatMessageTemplateTokens(tokens?: Record<string, unknown>[]): string {
  if (!tokens) return '';
  
  return tokens.map(token => {
    if ('Text' in token) return String(token.Text);
    if ('PropertyName' in token) return `{${String(token.PropertyName)}}`;
    return '';
  }).join('');
}

async function runTests() {
  console.log('Starting SEQ API tests...\n');

  try {
    // Test 1: Get Signals
    console.log('Test 1: Fetching shared signals...');
    const signals = await makeSeqRequest<any[]>('/api/signals', { shared: 'true' });
    console.log(`✓ Successfully retrieved ${signals.length} signals`);
    if (signals.length > 0) {
      console.log('Sample signal:', JSON.stringify(signals[0], null, 2));
      console.log(signals.map(s => s.Id).join(', '));
    }
    console.log();

    // Test 2: Get Events using range parameter
    console.log('Test 2: Fetching recent events using range...');
    const eventsWithRange = await makeSeqRequest<any[]>('/api/events', {
      range: '1h',
      count: '5'
    });
    console.log(`✓ Successfully retrieved ${eventsWithRange.length} events using range`);
    if (eventsWithRange.length > 0) {
      const sampleEvent = eventsWithRange[0];
      console.log('Sample event:', {
        ...sampleEvent,
        messageTemplate: formatMessageTemplateTokens(sampleEvent.messageTemplateTokens),
      });
    }
    console.log();

    // Test 3: Get Events with date range
    console.log('Test 3: Fetching events with explicit date range...');
    const toDate = new Date().toISOString();
    const fromDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    console.log(`Date range: ${fromDate} - ${toDate}`);
    const eventsWithDates = await makeSeqRequest<any[]>('/api/events', {
      fromDateUtc: fromDate,
      toDateUtc: toDate,
      count: '5'
    });
    console.log(`✓ Successfully retrieved ${eventsWithDates.length} events using date range`);
    console.log();

    // Test 4: Get Events with signal filter
    if (signals.length > 0) {
      const signalIds = signals.slice(0, 2).map(s => s.Id).join(',');
      console.log(`Test 4: Fetching events for signals ${signalIds}...`);
      const signalEvents = await makeSeqRequest<any[]>('/api/events', {
        signal: signalIds,
        range: '1h',
        count: '5'
      });
      console.log(`✓ Successfully retrieved ${signalEvents.length} events for signals`);
      if (signalEvents.length > 0) {
        const sampleEvent = signalEvents[0];
        console.log('Sample event with signal filter:', {
          ...sampleEvent,
          messageTemplate: formatMessageTemplateTokens(sampleEvent.messageTemplateTokens),
        });
      }
      console.log();
    }

  } catch (error) {
    if (error instanceof Error) {
      console.error('Test failed:', error.message);
    } else {
      console.error('Test failed with unknown error');
    }
  }
}

// Use ESM-style main module check
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };