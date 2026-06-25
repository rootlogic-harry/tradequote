import { SYSTEM_PROMPT } from '../../prompts/systemPrompt.js';

describe('Server-side SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('contains measurement methodology', () => {
    expect(SYSTEM_PROMPT).toContain('MEASUREMENT METHODOLOGY');
  });

  test('contains domain knowledge section', () => {
    expect(SYSTEM_PROMPT).toContain('DOMAIN KNOWLEDGE');
  });

  test('contains JSON schema', () => {
    expect(SYSTEM_PROMPT).toContain('"referenceCardDetected"');
    expect(SYSTEM_PROMPT).toContain('"measurements"');
    expect(SYSTEM_PROMPT).toContain('"labourEstimate"');
  });

  test('contains materials vs labour distinction', () => {
    expect(SYSTEM_PROMPT).toContain('MATERIALS vs LABOUR DISTINCTION');
  });

  // TRQ-79: when two walls are adjacent, the analysis was sometimes taking in
  // the wrong wall (e.g. measuring the intact neighbour instead of the
  // collapsed one, or combining both into a single measurement set). The
  // prompt needs explicit guidance on identifying the subject wall.
  test('instructs the analyser to pick the subject wall when multiple are visible (TRQ-79)', () => {
    // Look for the dedicated section header + key behavioural rules
    expect(SYSTEM_PROMPT).toMatch(/MULTIPLE WALLS|multiple walls/i);
    // Must defer to the user's briefNotes for disambiguation
    expect(SYSTEM_PROMPT).toMatch(/briefNotes/);
    // Must not combine measurements across walls
    expect(SYSTEM_PROMPT).toMatch(/do not combine|Do NOT combine/i);
  });

  // TRQ-122: "rubble" reads as disparaging in client-facing quote output
  // ("Replacement sandstone rubble"). Removed from example + specification
  // lines that Claude imitates; replaced with "walling stone".
  test('no "rubble" in material example lines (TRQ-122)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/matched rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/sandstone rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/gritstone rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/rubble course/i);
  });

  test('explicitly tells Claude to prefer "walling stone" over "rubble" (TRQ-122)', () => {
    // A CLIENT-FACING LANGUAGE section names the substitution so Claude
    // doesn't regress from its training-data default of "rubble".
    expect(SYSTEM_PROMPT).toMatch(/CLIENT-FACING LANGUAGE/i);
    expect(SYSTEM_PROMPT).toMatch(/walling stone/i);
  });

  // Mark's feedback 2026-06-25: "Remove the word catastrophic from
  // description unless Paul wants it, I nearly always delete it but it
  // keeps popping back up". Mirrors the TRQ-122 "no rubble" precedent —
  // ban it in CLIENT-FACING LANGUAGE so Claude doesn't regress from its
  // training-data tendency.
  test('"catastrophic" is banned from client-facing damage descriptions', () => {
    expect(SYSTEM_PROMPT).toMatch(/[Cc]atastrophic.{1,80}must not appear|must not appear.{1,80}[Cc]atastrophic/);
    // Sanity: the prompt itself isn't allowed to use the word as an example
    // outside the ban rule. There should be at most one occurrence.
    const occurrences = (SYSTEM_PROMPT.match(/catastrophic/gi) || []).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  // Measurement accuracy v2: methodology rigor. The prompt drives Claude
  // through an explicit 5-step scale/measure/check loop, recognises Tier A/B/C
  // scale anchors, and respects the new USER-PROVIDED SCALE REFERENCES channel
  // that the UI now sends as part of the text payload.
  describe('measurement methodology rigor', () => {
    test('prompt defines a stepwise measurement methodology', () => {
      expect(SYSTEM_PROMPT).toContain('MEASUREMENT METHODOLOGY');
      expect(SYSTEM_PROMPT).toMatch(/Step 1/);
      expect(SYSTEM_PROMPT).toMatch(/Step 2/);
      expect(SYSTEM_PROMPT).toMatch(/Step 3/);
      expect(SYSTEM_PROMPT).toMatch(/Step 4/);
      expect(SYSTEM_PROMPT).toMatch(/Step 5/);
    });

    test('prompt ranks scale anchors in TIER A / B / C', () => {
      expect(SYSTEM_PROMPT).toMatch(/TIER A/);
      expect(SYSTEM_PROMPT).toMatch(/TIER B/);
      expect(SYSTEM_PROMPT).toMatch(/TIER C/);
    });

    test('prompt teaches Claude to consume USER-PROVIDED SCALE REFERENCES', () => {
      expect(SYSTEM_PROMPT).toMatch(/USER-PROVIDED SCALE REFERENCES/);
    });

    test('prompt names plausibility bounds for typical wall dimensions', () => {
      expect(SYSTEM_PROMPT).toMatch(/Wall height/);
      expect(SYSTEM_PROMPT).toMatch(/Wall thickness/);
      expect(SYSTEM_PROMPT).toMatch(/Breach/);
    });

    test('prompt requires a measurementReasoning field for admin QA', () => {
      expect(SYSTEM_PROMPT).toMatch(/measurementReasoning/);
    });

    test('prompt enforces low confidence when no anchor is available', () => {
      expect(SYSTEM_PROMPT).toMatch(/referenceCardDetected is false AND no USER-PROVIDED SCALE REFERENCES/);
      expect(SYSTEM_PROMPT).toMatch(/set confidence: "low"/);
    });
  });

  // Pricing conventions: NET-of-VAT, 2-decimal money, mandatory confidence.
  // These were silently violated by Claude before — the prompt now states
  // them as preconditions so post-processing isn't undoing the AI's choices.
  describe('pricing conventions', () => {
    test('prompt has a PRICING CONVENTIONS section', () => {
      expect(SYSTEM_PROMPT).toMatch(/PRICING CONVENTIONS/);
    });

    test('prompt forbids adding VAT inside the analysis output', () => {
      expect(SYSTEM_PROMPT).toMatch(/NET of VAT/);
      expect(SYSTEM_PROMPT).toMatch(/Do NOT add VAT/i);
    });

    test('prompt requires monetary values to 2 decimal places', () => {
      expect(SYSTEM_PROMPT).toMatch(/2 decimal places/);
    });

    test('prompt requires every measurement to carry a confidence value', () => {
      expect(SYSTEM_PROMPT).toMatch(/MUST have a confidence value/);
      expect(SYSTEM_PROMPT).toMatch(/Never null, never missing/);
    });

    test('prompt forbids quantity strings with embedded units', () => {
      expect(SYSTEM_PROMPT).toMatch(/no "2\.5 t"/);
    });
  });

  // Lime mortar was being over-included (Paul / Harry, 2026-05-18). Dry stone
  // walling is by definition dry-laid; mortar is the exception, not the
  // default. The prompt previously listed lime mortar in the default
  // materials list and used it as the only example in the schedule-of-works
  // material-specs / construction-techniques bullets, which biased Claude
  // toward including it on every job.
  describe('mortar is conditional, not default', () => {
    test('"dry-laid" default is stated explicitly somewhere in the prompt', () => {
      // The model needs to know the baseline construction is unmortared
      // before it can decide when mortar is justified.
      expect(SYSTEM_PROMPT).toMatch(/dry-laid/i);
    });

    test('mortar materials are NOT in the default "MATERIALS (include)" block', () => {
      // Pull the default-materials section (between the section header and
      // the next major header). Lime mortar / NHL / mortar should not be
      // listed as a default item there.
      const block = SYSTEM_PROMPT.match(
        /MATERIALS \(include in "materials" array[^)]*\):[\s\S]*?(?=PLANT HIRE|MORTAR|LABOUR \()/
      );
      expect(block).not.toBeNull();
      const defaultMaterials = block[0];
      expect(defaultMaterials).not.toMatch(/lime mortar/i);
      expect(defaultMaterials).not.toMatch(/NHL/);
      expect(defaultMaterials).not.toMatch(/^- Mortar & sand/m);
    });

    test('a dedicated MORTAR section names explicit inclusion triggers', () => {
      // There should be a section that gates mortar on observable conditions:
      // existing mortar joints visible, tradesman explicitly spec'd it, or
      // exposed-site coping that needs bedding. Without one of those triggers,
      // do not include mortar.
      expect(SYSTEM_PROMPT).toMatch(/MORTAR/);
      expect(SYSTEM_PROMPT).toMatch(/only (when|if)/i);
    });

    test('MORTAR section names all four explicit triggers', () => {
      // Each trigger must be present in the prompt text so the model has
      // unambiguous yes/no signals for each path.
      expect(SYSTEM_PROMPT).toMatch(/visible mortar joints/i);                       // 1
      expect(SYSTEM_PROMPT).toMatch(/tradesman'?s? notes|briefNotes|voice transcript/i); // 2
      expect(SYSTEM_PROMPT).toMatch(/structural.*wall|retaining wall.*spec|garden wall|feature wall/i); // 3
      expect(SYSTEM_PROMPT).toMatch(/cope stones?.*exposed|estate boundary/i);       // 4
    });

    test('trigger #2 requires the mortared activity to appear in the schedule of works', () => {
      // Voice notes alone must not be enough — the schedule must reflect
      // the spec. Mitigates a model misread that could put mortar in the
      // materials array off a single ambiguous transcript phrase.
      expect(SYSTEM_PROMPT).toMatch(/voice notes\s+alone are not sufficient/i);
    });

    // Calibration investigation 2026-06-22 — three system-prompt edits
    // derived from the diff corpus. Each pins a behavioural constraint
    // the calibration loop could not fix via per-field notes.
    test('POST-CALCULATION ADJUSTMENT enforces asymmetric labour-days rule', () => {
      // The model must not apply a flat percentage factor to labour days.
      // The investigation found that three successive 0.X factors (0.90,
      // 0.85, 0.82) couldn't fix the asymmetric small-job bias.
      expect(SYSTEM_PROMPT).toMatch(/POST-CALCULATION ADJUSTMENT/);
      // Hard floor of 1.5 days for small jobs
      expect(SYSTEM_PROMPT).toMatch(/minimum of 1\.5 days/i);
      // Stepwise rule by area
      expect(SYSTEM_PROMPT).toMatch(/under 6 m²/);
      expect(SYSTEM_PROMPT).toMatch(/6.{1,3}20 m²/);
      expect(SYSTEM_PROMPT).toMatch(/over 20 m²/);
      // Explicit instruction to ignore factor calibration notes — without
      // this the model will keep chasing whatever the calibration loop
      // writes in. This guard MUST stay.
      expect(SYSTEM_PROMPT).toMatch(/IGNORE that note|ignore .{1,40}calibration note/i);
    });

    test('CHAPTER 8 traffic management is per-day, not a fixed line item', () => {
      expect(SYSTEM_PROMPT).toMatch(/CHAPTER 8 TRAFFIC MANAGEMENT/);
      // Empirical range from the investigation
      expect(SYSTEM_PROMPT).toMatch(/£100.{1,3}£180 per day/);
      // Multiply by occupation-days — the key behaviour change
      expect(SYSTEM_PROMPT).toMatch(/[Mm]ultiply by the number of days/);
      // Explicit omission rule for off-road walls — without this the
      // model adds the line to every quote regardless of context
      expect(SYSTEM_PROMPT).toMatch(/off-road|grass verge|do not include|must be omitted/i);
    });

    test('WASTE DISPOSAL is stone-type-aware (gritstone/limestone multiplier)', () => {
      expect(SYSTEM_PROMPT).toMatch(/WASTE DISPOSAL/);
      // Base estimate range
      expect(SYSTEM_PROMPT).toMatch(/£140.{1,3}£180/);
      // The 1.6× multiplier for denser stone types — Mark vs Paul
      // divergence on this field was the cleanest evidence
      expect(SYSTEM_PROMPT).toMatch(/1\.6×|1\.6x|1\.6 ?times/i);
      expect(SYSTEM_PROMPT).toMatch(/[Gg]ritstone.{1,40}[Ll]imestone|[Ll]imestone.{1,40}[Gg]ritstone/);
      // Haulage contingency for large jobs
      expect(SYSTEM_PROMPT).toMatch(/over 20 m².{1,200}£100/s);
    });

    // Mark's feedback 2026-06-25: AI was quoting for new foundation on
    // every job — Mark said "80% of the time this is not necessary".
    // Mirror the MORTAR conditional-inclusion pattern: default OFF,
    // inclusion only on explicit triggers.
    test('FOUNDATION WORKS rule defaults to no-foundation with explicit triggers', () => {
      expect(SYSTEM_PROMPT).toMatch(/FOUNDATION WORKS/i);
      // Default-off framing
      expect(SYSTEM_PROMPT).toMatch(/do NOT require new foundation works|by default.{1,40}no foundation/i);
      // At least 3 triggers named (subsidence, below ground, tradesman briefNotes)
      expect(SYSTEM_PROMPT).toMatch(/subsidence/i);
      expect(SYSTEM_PROMPT).toMatch(/below ground/i);
      expect(SYSTEM_PROMPT).toMatch(/briefNotes/i);
    });

    test('SCHEDULE OF WORKS examples do not bias toward mortar', () => {
      // The previous prompt used "NHL 3.5 hydraulic lime mortar" as the ONLY
      // material-spec example, and "bedded and set plumb on a cement and lime
      // mortar bed" as the ONLY construction-technique example. Those biased
      // Claude toward mortared output on every job. Pull the SCHEDULE OF WORKS
      // DETAIL block and confirm the bullets reference dry-laid alternatives
      // (or stay generic) — not just mortar.
      const block = SYSTEM_PROMPT.match(/SCHEDULE OF WORKS DETAIL:[\s\S]*?Do NOT use vague/);
      expect(block).not.toBeNull();
      const sched = block[0];
      // At least one of the examples must explicitly mention dry-laid
      // construction so the prompt is balanced, not mortar-only.
      expect(sched).toMatch(/dry-laid|dry laid|without mortar/i);
    });
  });
});
