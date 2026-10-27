// Copyright (c) 2026, Rademics. All rights reserved.
// Plain-English wording for the standard checks on every form and API request
// (found in the launch check of 27 October 2026: an empty field said
// "Too small: expected string to have >=1 characters"). A message written on a
// rule itself, such as "Not a valid PAN", still wins over these.
import { z } from 'zod';

type Issue = z.core.$ZodRawIssue;

const FORMATS: Record<string, string> = {
  email: 'Not a valid email address',
  uuid: 'Please choose one from the list',
  guid: 'Please choose one from the list',
  url: 'Not a valid web address',
  regex: 'Not in the right form',
  date: 'Not a valid date',
  datetime: 'Not a valid date and time',
};

/** The message shown for a standard check, or undefined to keep the rule's own. */
export function plainMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') return min <= 1 ? 'Please fill this in' : `Use at least ${min} characters`;
      if (issue.origin === 'array' || issue.origin === 'set') return min <= 1 ? 'Add at least one' : `Add at least ${min}`;
      return issue.inclusive ? `Must be ${min} or more` : `Must be more than ${min}`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `Use at most ${max} characters`;
      if (issue.origin === 'array' || issue.origin === 'set') return `No more than ${max}`;
      return issue.inclusive ? `Must be ${max} or less` : `Must be less than ${max}`;
    }
    case 'invalid_type':
      if (issue.input === undefined || issue.input === null || issue.input === '') return 'Please fill this in';
      if (issue.expected === 'number' || issue.expected === 'int') return 'Must be a number';
      return 'Not a valid value';
    case 'invalid_format':
      return FORMATS[issue.format] ?? 'Not in the right form';
    case 'invalid_value':
      return 'Please choose one from the list';
    case 'not_multiple_of':
      return 'Not an allowed amount';
    case 'unrecognized_keys':
      return 'Unexpected field';
    default:
      return undefined;
  }
}

z.config({ customError: plainMessage });
