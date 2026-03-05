import { md5Uuid } from './uuid.js';

const emails = [
  'test@email.com', 'mike.smith@google.com', 'me@test.com', 'nicolas.dextraze@eventsourcing.com', 'john.smithe@yahoo.com',
  'bob.gratton@joke.quebec', 'marcel.aubut@dkc.ca', 'just.another.one@fortheroad.us'
];

for (const email of emails) {
  test(`md5Uuid(${email}) is a valid uuid`, function() {
    expect(() => md5Uuid(email)).not.toThrow();
  })
}
