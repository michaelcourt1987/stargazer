const greeting = document.getElementById("greeting");
const button = document.getElementById("greet-btn");

const messages = [
  "Hello, world!",
  "Hi there!",
  "Welcome!",
  "Good to see you.",
];

button.addEventListener("click", () => {
  const next = messages[Math.floor(Math.random() * messages.length)];
  greeting.textContent = next;
});
