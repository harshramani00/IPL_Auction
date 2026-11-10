# 3D models

The hall's auctioneer is `rocketbox/Business_Male_01.fbx` from Microsoft's
Rocketbox avatar library (MIT, see `rocketbox/LICENSE.md`). The textures were
converted from the original TGA files to JPG and PNG.

The team owners and audience are six more Rocketbox avatars in `rocketbox/people/`
(Business_Male_02–04, Business_Female_01–03), with textures downsized to 1024 px
(colour) and 512 px (normal maps) since they're seen from further away.

An `auctioneer.glb` here replaces him, for example a MetaHuman you've exported.

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
