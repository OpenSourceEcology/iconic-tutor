// Resolve workshop navigation independently of the CAD catalog and 3D viewer.
export const studioDeployment = fetch("deployment.json", {cache: "no-store"})
  .then(response => response.ok ? response.json() : {})
  .catch(() => ({}));

studioDeployment.then(deployment => {
  const sameOrigin = deployment.backend === "same-origin";
  const coach = sameOrigin ? "coach.html" : deployment.workshop_url;
  if (!coach) return;
  for (const link of document.querySelectorAll("[data-module-coach]")) {
    link.href = coach;
    link.hidden = false;
  }
  if (!sameOrigin || deployment.workshop) {
    const note = document.getElementById("hosting-note");
    note.querySelector("span").textContent =
      "Explore and export designs here. Use your workshop invitation to chat with the AI about documenting a module.";
    note.hidden = false;
  }
});
