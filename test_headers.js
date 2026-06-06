async function test() {
  const res = await fetch("http://localhost:3000/api/auth/lookup-username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "supervisor_shg" })
  });
  console.log("Headers:");
  for (const [key, val] of res.headers.entries()) {
    console.log(key, val);
  }
}
test();
