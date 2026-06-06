async function test() {
  const res = await fetch("http://localhost:3000/api/me");
  const text = await res.text();
  console.log("/api/me:", text);
}
test();
