# Scope Node

**Scope Node** is a multiplayer top-down twin-stick shooter built around perfect information and instakill aimbot.
There is no health, no aiming, and no reaction time.

---

## Core Objective

At the center of the map lies a single **orb**.
Touching the orb results in an **instant win**.

---

## Perfect Information

* No fog of war
* No hidden enemies
* No vision loss due to obstacles

At all times, players know:

* The full map layout
* The exact position of every player
* The current movement path of every player
* The exact regions of visibility for every player
---

## Line-of-Sight Overlay

Judging line of sight precisely by eye is difficult, especially under pressure. Scope Node provides a real-time overlay that classifies the map into visibility regions:

1. **Safe Zone**
   Areas you can see, but enemies cannot see you.

2. **Kill Zone**
   Areas where enemies can see you, but you cannot see them.

These regions are continuously recomputed and visualized for every player on the map.

---

## Combat Rules

* Players shoot from the **center point** of their model.
* If any part of your body enters a region that an enemy can see, you die instantly.
* If your center point enters a region where you can see an enemy **without** revealing yourself to their Safe Zone, they die instantly.