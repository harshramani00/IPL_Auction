# 3D models

`auctioneer.glb` here replaces the stand-in auctioneer in the 3D hall.

It should be one binary glTF with a humanoid rig and these animation clips
(names are matched loosely, Mixamo's defaults work):

| Pose | Clip name contains |
|---|---|
| idle | `idle` or `stand` |
| announcing a player | `talk`, `speak` or `explain` |
| pointing at a bid | `point` |
| gavel raised (going once / twice) | `raise`, `hand up`, `salute` or `cheer` |
| gavel strike (SOLD) | `hammer`, `strike`, `pound` or `knock` |

The game scales him to 1.82 m and puts a gavel in the bone whose name ends in
`RightHand`. Source files (FBX from Character Creator or a scan, plus Mixamo
clips) go in `auctioneer-src/`, which is git-ignored.

`auctioneer.glb` is git-ignored too: most bought or Character Creator models
may not be redistributed, and this repo is public. Copy it to the hosting
machine by hand (e.g. `scp static/models/auctioneer.glb host:IPL_Auction/static/models/`),
then rebuild.
