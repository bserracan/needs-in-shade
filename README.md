# Daily needs in the shade

A 3D map of central Weimar. Click a point and it shows how far you can walk in 5, 10 and 15 minutes, who lives there, how far it is to food, health and school, and the shadiest way to them at the time of day you choose. It also shows which residents miss out.

Live page: https://bserracan.github.io/needs-in-shade/

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

## How to use it

1. Click anywhere on the map to set your start.
2. Click an orange, pink or blue building to see the fastest and the shadiest way to that place.
3. Click a number under "Who misses out" to see those residents on the map.
4. Change the date and the time to see the buildings' shadows move across the city.

## Rainy evening: a family that thinks

Switch to **Rainy evening** for a second, imagined story on the same streets. Weimar has an abandoned factory, restored as a community centre, the Fabrik. In this story it stands where the Weimar Atrium shopping centre is today. It's pouring after sunset, and a family with a pram is trying to get there. Claude plays the father: born and raised in Weimar, he has never seen it flood, so each time he changes his route he says one shocked German word from a fixed list (Echt jetzt?, Krass!, Heiliger Strohsack! and others). You play the storm: each street you click strikes lightning.

1. Click a street to place the family, then press Start.
2. Click a street to flood it. Click it again to clear it.
3. Read what they noticed, what they did and why, in the log and above the family on the map.

**What it notices:** where the family is, how wet and tired they are, the rain, the walk to the Fabrik, flooded streets on their way, and nearby buildings they could shelter in.

**When it thinks:** when the walk starts, when a street floods on their way, when they get very wet, when they reach a shelter, and every 30 seconds if nothing else happens (every 10 seconds while sheltering). Never more than once in 4 seconds, or 30 times in a walk.

**What it does:** it chooses one action, with a reason: keep going, go around, shelter or head out. The app checks that the action is possible and carries it out.

**Only on localhost.** The thinking runs through a small connection in the dev server (`server/family-brain.js`), which calls `claude -p` with no tools on the Claude account of whoever runs it. No key is stored. On the live page that connection doesn't exist, so the page says the family only thinks on localhost and they just follow the shortest way. To change who the family is, edit the description at the top of `server/family-brain.js` and restart `npm run dev`.

**Real and imagined.** The streets, the buildings and the sunset time for 7 November are real. The rain, floods, the family and how wet and tired they get are invented rules, not measurements. The amber building is the real footprint of the Weimar Atrium (Friedensstraße 1, found by its OpenStreetMap position), which plays the Fabrik in this story: it isn't really an abandoned factory or a community centre. Which buildings are open is a guess from their use.

## Method

- **Walking.** 4.8 km/h, which is 80 m per minute, along the pedestrian network, from the node nearest the click. If no walkable street is within 100 m, the app says so.
- **Areas.** The street segments reached in 5, 10 and 15 minutes, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. A building counts if it touches the shape.
- **Residents in an area.** For each overlapping census cell, its population times the share of the cell's area inside. Added up and rounded to the nearest 10. Cells without a published figure aren't zero: they are left out, and the count of them is shown next to the sum.
- **Daily needs.** A building counts as a place for food, health or school if that is its main use, or if it has at least 50 m² of that use. Food is `food_and_drink`, health is `health`, school is `education`.
- **Sun and shade.** The sun's position is calculated for Weimar's location and the chosen date and clock time, any day of the year, and it casts the shadows on the map. Every 5 m along a street, the app follows the line from head height (1.5 m) towards the sun over a 2 m grid of building heights. If a building is taller than that line, the point is in shade.
- **Shadiest way.** Of all walks of up to 15 minutes, the one with the fewest metres in the sun. The map also shows the fastest way, dashed.
- **Who misses out.** Each census cell is split into 25 squares that share its residents equally, and each square walks from its nearest node. Three tests: more than 15 minutes from the need, more than 5 minutes from it, or no way there within 15 minutes with under 100 m in full sun.

## What it finds

At 15 minutes, nobody in the kit misses out on food, health or school: from every street the nearest one is under 9 minutes away. The stricter tests do separate people, but many of those people live close to the kit's edge, so the page gives that share with each result.

## Limits

- Only buildings cast shade. The kit has no trees, so parks and tree-lined streets look sunnier than they are. The ground counts as flat, and heights run to the top of the roof, so shadows run slightly long.
- Food means cafés and restaurants: food shops sit inside `retail` and can't be told apart. School means all education buildings, including the university.
- Places count as reached at the node nearest their middle, as the kit has no entrances.
- Nothing outside the kit is counted, so walks and places stop at its edge, and people near the edge may only seem to miss out.
- The 50 m² and 100 m limits are choices, not measurements. Floor areas are estimates. The census changes small counts slightly at random to protect privacy, so single cells are approximate.
- Who misses out uses each cell's average age and rent, not figures for the people themselves.

## Style

The look follows a colour-block style guide for architectural diagrams, with three deliberate differences:

- Roofs are flat, as the kit has one height per building and no roof shapes.
- Trees, hedges and garden furniture aren't drawn. Invented trees would suggest shade the app doesn't calculate. Thin green lines show the plot boundaries instead.
- The guide asks for no cast shadows, but this map is about shade, so buildings cast real shadows. Streets also show it: white in the sun, slate in shade.

The guide's colours are for housing types, which the kit doesn't record, so they are given to building uses.

## Data and credit

Everything comes from `public/data/`; see `SOURCES.md` there.

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

Headline font: Barlow Condensed (SIL Open Font License), stored with the site.

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided: I decided to ask which daily needs are within 15 minutes, who misses out and what the shadiest way there is, and to open the map on 1 June at 17:00 in my own colour-block style.
3. The agent did: built the walking map from the starter prompt, added the daily-needs, who-misses-out and shadiest-way features in my style guide, and cross-checked the numbers with a second geometry tool.
4. I checked: I checked by clicking several start points and buildings, moving the time slider to see the shade and routes change, and confirming that a far-away walk took a believable time for its distance.
5. For the rainy evening: I decided on the story of the factory and the family trying to reach somewhere dry. The agent built the mode, the rules and the connection to Claude, whose family decisions run on the model Claude Haiku.
