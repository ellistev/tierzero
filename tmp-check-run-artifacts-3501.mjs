const urls = [
  'http://127.0.0.1:3501/run-artifacts',
  'http://127.0.0.1:3501/api/run-artifacts',
  'http://127.0.0.1:3501/api/run-artifacts/latest',
];
for (const url of urls) {
  const res = await fetch(url);
  const text = await res.text();
  console.log(`URL ${url}`);
  console.log(`STATUS ${res.status}`);
  console.log(text.slice(0, 1000));
  console.log('\n---');
}
