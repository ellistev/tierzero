const urls = [
  'http://127.0.0.1:3500/run-artifacts',
  'http://127.0.0.1:3500/api/run-artifacts',
  'http://127.0.0.1:3500/api/run-artifacts/latest',
];
for (const url of urls) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`URL ${url}`);
    console.log(`STATUS ${res.status}`);
    console.log(text.slice(0, 4000));
    console.log('\n---');
  } catch (err) {
    console.log(`URL ${url}`);
    console.log(`ERROR ${(err && err.message) || err}`);
    console.log('---');
  }
}
