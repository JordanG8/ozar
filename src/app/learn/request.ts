export async function request<T>(body: object, path = "/api/learn"): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error("פג תוקף הכניסה. יש לרענן את הדף ולהתחבר מחדש.");
  if (response.status === 409) throw new Error("התרגול השתנה בחלון אחר. יש לרענן את הדף כדי להמשיך.");
  if (!response.ok) throw new Error("החיבור נקטע. אפשר לנסות שוב.");
  return response.json();
}
