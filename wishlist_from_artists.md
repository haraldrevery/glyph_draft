# Some features artists have been asking about.

> **Note:** This is the artists' original wishlist (raw input), **not** a status or
> TODO list. For what is implemented vs. still open, see **CLAUDE.md → "Known Gaps vs
> Artist Wishlist"**.

- Bezier curve (similar to Adobe illustrators "pen tool") tool to make nice smooth lines --> outlines are not destructive to the line and can easily pick the outline settings (to emulate a quill pen or brush angle, I can set up regions on the outline).
- If two lines connect, either have fill or not fill.
- A nice brush stroke library that is not destructive when outlining the stroke, can always change the brush/stroke type for that path line.
- Being able to lock layers (no mistake of ruining it)
- Be able to just draw: straight lines, boxes/squares, circles, polygons and triangles.  
- Grid lock (so the  lines/Bezier curve points can be locked to fixed points or when moving parts) should be able to toggle on/off
- The grid should have a settings where you can increase the density of the lines.
- On export, be able to set a "universal scale" so that the svg is sized in percent to what the editing value is (so user doesn't have to do it in fontforge during import)
- On export: each svg is named "u_xxxx.svg" (no "+" and lower case letters)
- layer system (similar to illustrator)
- Should be able to mark parts (or the whole layer) --> copy/cut --> onto a new layer (even on another glyph). When you copy a shape from glyph A and paste it onto glyph B, it should land on the same absolute coordinates.
- 1 glyph = 1 svg
- Select tool to select nodes (lasso tool and a box select tool)
- Select multiple layers at the same time and work with as it's one layer (ctrl + click on the layers).
- Boolean operations between layers (make "transparent" holes using another layers shape). Not boolean operations for elements within a layer, BETWEEN layers.
- quickly switch between each glyph (have a Glyph/svg set management to the left including mini thumbnails of all the existing glyphs)
- ghost/guide layer, can also choose to have a low opacity background of another glyph (you can toggle what layers should be visible in the background)
- export: is exporting all the glyph (the svg as final outlined versions) to one folder that you name to title.zip
- Option to export one glyph as svg
- Robust and stable "save" protocol, saving projects should be as safe with low risk of corruption. Users should be able to save the project and then be able to import and continue working on a new computer without any issues. Note: Export project AND export svg glyph(s).
- Filled or transparent values focused, but should have color support (in case the user wants to import existing svg files)
- At the start and end point, for the outline strokes, make it easy to implement typography serif "foot"/"ears" (users can set the flatness angle or if it should be a blob as a pen etc), separate settings for the start and end point (also being able to flip the end and start setting for that path). 
- Cap, corner and align stroke settings support. 
- Nice brush stroke/"width profile" library for the paths.
- The workflow should be more focused on drawing a path, then adjust stroke outlines to make the path rather than drawing filled paths making it difficult to adjust glyphs later.
- dark/light mode
- zoom and pan
- Path direction:  font outlines have winding rules. Outer contours should be clockwise, inner contours (holes) counter-clockwise (or vice versa depending on format). Your boolean ops need to handle this, and you may want an auto-fix option.
- Web version can use LocalForage
- Desktop version should be a Tauri wrapper, if needed, use an abstraction layer if you need something in case of an electron wrapper later. 
- Undo/redo button (ctrl+z and ctrl+y)
- Metrics guides with an included em square (so it's easy to know the size when drawing)
- If you delete a node either connect the neighboring nodes OR it splits the path to two new paths (have a toggle setting for the users to pick said behavior they prefer)
- add a right click menu when doing things on the canvas (for users who don't know short cuts and easier way of doing operations)
- The serif foot exists, but not the asymmetric version doesn't exist yet (that letters like "F", "T" and "L" has), add this cap option later. 
Maybe a "cap designer" so users can create their own serif/teardrop shapes for making their own unique caps?
- Selecting something and make it rotate around the center or a marked point? (I think is is in the transform box category...)
- One panel per tool (the tool panel switches depending on what tool is the current selected one). Right now, there is a "polygon sides" slider for the view panel.
- Each panel should be movable. 
- Free pen drawing (then the path gets a little simplified/smoothed in case of the mouse being jagged line)
- Knife / Scissors / Eraser Tool: Essential for quickly slicing a path in half or erasing segments of a stroke manually rather than selecting and deleting individual nodes.
- Manual "Expand/Flatten" Stroke: You mentioned that exporting auto-outlines the strokes. However, artists often want to manually convert a non-destructive stroke into a filled shape during the design process so they can manually tweak the resulting vector points.
- Outline vs. Preview Mode Toggle: A quick hotkey to toggle between seeing the full rendered brush strokes/fills and a raw, bare-bones "wireframe" view of the path skeletons. This is crucial for precise node editing.
- Importing svg file support, lands on a new layer on the current glyph.
- If marked multiple paths, alignment operation --> alignment types like in Adobe Illustrator/Photoshop
- Need an option in the web version to export the project so that the user can import it in the offline desktop version and keep working there.

Bold and italic export feature:
- Bold: Adjust a horizontal stretch (adjusted in percent) and horizontal outline extension (all the svg gets expanded horizontally only, not extended perpendicular to the svg edges) 
- Italic: Horizontal skew  (adjusted in degrees) and horizontal outline negative extension (all the svg gets retracted horizontally inwards only, not perpendicular to the svg edges) 

Note, for the Horizontal skew make sure it reposition the nodes before the stroke extension. The idea is to make an "ok" bold and italic export of a font.

---

# Very difficult stuff

- In the settings drop down menu, have a language selection for the software (might be a massive rewrite...)

- "Blending mode/option" between layers (not the color thing, the "blend shape" one similar to the one in Adobe Illustrator where two shapes have step by step iterations from layer A to layer B as an echo effect thing).

- Think this through: Rounding corners? But more general than illustrator? If all nodes are corner nodes --> equal "radius" curve? Might need a path logic rewrite? Alternative description:"Rounded corners" for paths, like a smoother arc between 3 nodes (the middle node is the one you set the settings to)? (like the one in illustrator), have a slider for how much rounding that middle node have. (this might be messy to implement). Should also be able to have for multiple nodes.

- Doted/dashed stroke line, standard block lines, circles with a slider for various settings (space between and size etc, if the non-uniform thickness perpendicular lines work, use those to adjust size and/or density ), also include custom svg repeating on the line (user can import an svg).

- "Emerged complexity/procedural" brush strokes (growing tree and leafs branches, L-systems, voronoi fracture, and reaction diffusion etc along the path line with sliders and profile graphs for different parameters). Experimental, but fun way to create interesting brushes (might be too computational heavy). Might be worth a try since it would make this software stand out.

- Halftoning brush: can pick custom grid patterns.