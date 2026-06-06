async function test() {
  const res = await fetch("http://localhost:3000/api/auth/lookup-username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "supervisor_shg" })
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}
test();
