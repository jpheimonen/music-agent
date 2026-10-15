# Radio selection and public sources

The existing KEXP, Yle Radio 1 and Radio Helsinki presets remain. Six additions broaden the selection without using a general station directory or popularity ranking. The choices favour people selecting music, unusual records and cultural programming.

| Addition | Why it fits | Sources |
| --- | --- | --- |
| FIP | Wide-ranging selections across jazz, soul, rock and music from around the world. Its live feed sampled Art Test, Sabine Devieilhe, Maya Ongaku and Brad Mehldau. | [Station](https://www.radiofrance.fr/fip), [live metadata](https://api.radiofrance.fr/livemeta/pull/7). The stream URL was discovered through a [community report](https://community.roonlabs.com/t/new-fip-streaming-url/87335) and checked directly. |
| WFMU | Listener-supported freeform radio. DJs choose their own music, making it a strong fit for discoveries and unusual selections. | [About](https://wfmu.org/about/), [official stream list](https://wfmu.org/audiostream.shtml). |
| NTS 1 and NTS 2 | Two channels of presenter-led music. NTS describes its commitment to human curation and freedom for its hosts. | [About](https://www.nts.live/about), [live programmes](https://www.nts.live/api/v2/live). Stream discovery: [public NTS CLI](https://github.com/tiktuk/nts-radio-cli). |
| Radio Paradise Main Mix | A human-mixed blend of rock, electronic, folk and global music, providing a less abrasive companion to the freeform stations. | [Main Mix](https://radioparadise.com/listen/channels/main-mix), [official stream links](https://radioparadise.com/listen/stream-links), [live metadata](https://api.radioparadise.com/api/now_playing?chan=0). |
| Worldwide FM | Underground music and culture from around the world, with local independent scenes and emerging artists. | [Official about page and stream](https://www.worldwidefm.net/about). |

On 15 October 2026, direct bounded HTTP probes returned 200 and audio bytes from all six new stream URLs, including both NTS channels. NTS redirects to an HTTPS Radio Mast relay. These probes establish endpoint reachability, not browser decoding or human audibility; browser checks are reported separately.

KEXP, FIP, NTS and Radio Paradise's metadata endpoints returned usable JSON during investigation. KEXP supplies the latest logged song start, FIP supplies track intervals, NTS supplies current programme intervals and Radio Paradise supplies a remaining duration. Adapters use these distinct meanings rather than inventing tracks from programme names. The interfaces are public but mostly undocumented and may change.

Radio Helsinki's [public scraper reference](https://github.com/janiluuk/tahti-org/pull/531) identifies server-rendered `current-song-title`, `current-song-artist` and `current-program-title` fields. The adapter reads only those fields from the station homepage. Managed retrieval reported ambiguous duplicate headers and Python HTTP requests returned 403 for the homepage and existing stream, but the running app's Node fetch succeeded: at approximately 14:46 UTC the API returned Surprise Chef — Rosemary Hemphill. This verifies the live HTML integration as well as its fixtures. Missing fields and access errors return unavailable, without retaining an earlier title.

NTS returns `Cache-Control: public, max-age=900`. A response older than two minutes can still describe the current programme accurately. NTS and FIP use the explicit start/end intervals to decide currency; undated and relative-duration feeds also account for HTTP age.

No suitable live metadata source was verified for Yle Radio 1, WFMU or Worldwide FM in this pass. Their streams remain usable, with a clear message when track information is not provided. BBC Radio 3 was not added because the researched stream sources were old and access differed by region.
