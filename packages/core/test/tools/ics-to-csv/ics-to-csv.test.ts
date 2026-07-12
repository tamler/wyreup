import { describe, expect, it } from 'vitest';
import { icsToCsv } from '../../../src/tools/ics-to-csv/index.js';
import type { IcsEventRow, IcsToCsvParams } from '../../../src/tools/ics-to-csv/types.js';
import type { ToolRunContext } from '../../../src/types.js';

const CALENDAR = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:timed-1\r
DTSTART;TZID=America/New_York:20260115T093000\r
DTEND;TZID=America/New_York:20260115T103000\r
SUMMARY:Quarterly planning meeting with the product and engineering\r
 teams\r
LOCATION:Room 4\r
DESCRIPTION:Bring forecasts\\, milestones\\; and risks\\nCoffee provided\r
STATUS:CONFIRMED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:all-day-1\r
DTSTART;VALUE=DATE:20260201\r
DTEND;VALUE=DATE:20260202\r
SUMMARY:Company holiday\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:recurring-1\r
DTSTART:20260301T120000Z\r
DTEND:20260301T123000Z\r
SUMMARY:Weekly sync\r
RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO\r
END:VEVENT\r
END:VCALENDAR\r
`;

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(params: IcsToCsvParams = {}): Promise<Blob> {
  const input = new File([CALENDAR], 'calendar.ics', { type: 'text/calendar' });
  const [output] = (await icsToCsv.run([input], params, makeCtx())) as Blob[];
  return output!;
}

describe('ics-to-csv — metadata', () => {
  it('declares conversion and export metadata', () => {
    expect(icsToCsv.id).toBe('ics-to-csv');
    expect(icsToCsv.category).toBe('convert');
    expect(icsToCsv.categories).toEqual(['convert', 'export']);
    expect(icsToCsv.cost).toBe('free');
    expect(icsToCsv.input.accept).toEqual(['text/calendar']);
    expect(icsToCsv.defaults).toEqual({ format: 'csv', includeAllDay: true });
    expect(icsToCsv.llmDescription).toBeTruthy();
  });
});

describe('ics-to-csv — run()', () => {
  it('writes timed, all-day, folded, escaped, and recurring events as CSV', async () => {
    const output = await run();
    const csv = await output.text();

    expect(output.type).toBe('text/csv');
    expect(csv.split('\r\n')[0]).toBe(
      'start,end,summary,location,description,status,all_day,rrule,uid',
    );
    expect(csv).toContain(
      '20260115T093000 (2026-01-15T09:30:00; TZID=America/New_York)',
    );
    expect(csv).toContain('Quarterly planning meeting with the product and engineeringteams');
    expect(csv).toContain('"Bring forecasts, milestones; and risks\nCoffee provided"');
    expect(csv).toContain('20260201 (2026-02-01)');
    expect(csv).toContain(',true,,all-day-1');
    expect(csv).toContain('FREQ=WEEKLY;COUNT=4;BYDAY=MO');
    expect(csv).toContain('20260301T120000Z (2026-03-01T12:00:00Z)');
  });

  it('returns the same event fields in JSON mode', async () => {
    const output = await run({ format: 'json' });
    const events = JSON.parse(await output.text()) as IcsEventRow[];

    expect(output.type).toBe('application/json');
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      start: '20260115T093000 (2026-01-15T09:30:00; TZID=America/New_York)',
      end: '20260115T103000 (2026-01-15T10:30:00; TZID=America/New_York)',
      summary: 'Quarterly planning meeting with the product and engineeringteams',
      location: 'Room 4',
      description: 'Bring forecasts, milestones; and risks\nCoffee provided',
      status: 'CONFIRMED',
      all_day: false,
      rrule: '',
      uid: 'timed-1',
    });
    expect(events[2]!.rrule).toBe('FREQ=WEEKLY;COUNT=4;BYDAY=MO');
  });

  it('filters all-day events when includeAllDay is false', async () => {
    const output = await run({ format: 'json', includeAllDay: false });
    const events = JSON.parse(await output.text()) as IcsEventRow[];

    expect(events.map((event) => event.uid)).toEqual(['timed-1', 'recurring-1']);
    expect(events.every((event) => !event.all_day)).toBe(true);
  });
});
