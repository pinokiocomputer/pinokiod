const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const ManagedSkills = require("../kernel/managed_skills")

async function withTempHome(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-managed-skills-"))
  const homedir = path.resolve(root, "home")
  const userhome = path.resolve(root, "user")
  await fs.mkdir(homedir, { recursive: true })
  await fs.mkdir(userhome, { recursive: true })
  try {
    await fs.writeFile(path.resolve(homedir, "AGENTS.md"), "# Home instructions\n\nUse Pinokio carefully.\n")
    await fn({
      root,
      homedir,
      userhome,
      kernel: {
        homedir,
        path: (...parts) => path.resolve(homedir, ...parts),
        exec: async () => {}
      },
      publishRoots: ManagedSkills.publishRoots(userhome)
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function readJson(filepath) {
  return JSON.parse(await fs.readFile(filepath, "utf8"))
}

function cloneTargetFromMessage(message) {
  const command = Array.isArray(message) ? message[0] : message
  assert.ok(command && command._ && Array.isArray(command._), "Clone command should use structured shell arguments.")
  return command._[command._.length - 1]
}

function cloneRefFromMessage(message) {
  const command = Array.isArray(message) ? message[0] : message
  assert.ok(command && command._ && Array.isArray(command._), "Clone command should use structured shell arguments.")
  return command._[command._.length - 2]
}

test("managed skills publish built-ins by default and respect disable state", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })

    const index = await readJson(ManagedSkills.indexPath(kernel))
    assert.equal(index.skills.pinokio.enabled, true)
    assert.equal(index.skills.gepeto.enabled, true)
    assert.equal(index.skills.pinokio.publishName, "pinokio")
    assert.equal(index.skills.gepeto.publishName, "gepeto")

    for (const root of publishRoots) {
      assert.match(await fs.readFile(path.resolve(root, "pinokio", "SKILL.md"), "utf8"), /name: pinokio/)
      assert.match(await fs.readFile(path.resolve(root, "gepeto", "SKILL.md"), "utf8"), /name: gepeto/)
      const marker = await readJson(path.resolve(root, "gepeto", ManagedSkills.MARKER_FILENAME))
      assert.equal(marker.manager, "pinokio")
      assert.equal(marker.skillId, "gepeto")
    }

    await ManagedSkills.setSkillEnabled(kernel, "gepeto", false, { publishRoots })

    for (const root of publishRoots) {
      await assert.rejects(
        fs.stat(path.resolve(root, "gepeto")),
        { code: "ENOENT" }
      )
      assert.match(await fs.readFile(path.resolve(root, "pinokio", "SKILL.md"), "utf8"), /name: pinokio/)
    }
  })
})

test("built-in publish names are fixed", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })

    await assert.rejects(
      ManagedSkills.setSkillPublishName(kernel, "gepeto", "custom-gepeto", { publishRoots }),
      /Built-in skill publish names cannot be changed/
    )

    const index = await readJson(ManagedSkills.indexPath(kernel))
    index.skills.gepeto.publishName = "custom-gepeto"
    await fs.writeFile(ManagedSkills.indexPath(kernel), JSON.stringify(index, null, 2))

    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })

    const updated = await readJson(ManagedSkills.indexPath(kernel))
    assert.equal(updated.skills.gepeto.publishName, "gepeto")
    for (const root of publishRoots) {
      assert.match(await fs.readFile(path.resolve(root, "gepeto", "SKILL.md"), "utf8"), /name: gepeto/)
      await assert.rejects(
        fs.stat(path.resolve(root, "custom-gepeto")),
        { code: "ENOENT" }
      )
    }
  })
})

test("enabled managed skills repair deleted published copies on sync", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    await fs.rm(path.resolve(publishRoots[0], "pinokio"), { recursive: true, force: true })

    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })

    assert.match(await fs.readFile(path.resolve(publishRoots[0], "pinokio", "SKILL.md"), "utf8"), /name: pinokio/)
  })
})

test("managed skills do not overwrite user-owned conflicts", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    const conflictDir = path.resolve(publishRoots[0], "gepeto")
    await fs.mkdir(conflictDir, { recursive: true })
    await fs.writeFile(path.resolve(conflictDir, "SKILL.md"), "---\nname: custom-gepeto\n---\n\nCustom content.\n")

    const result = await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    const gepeto = result.results.find((entry) => entry.id === "gepeto")
    const conflict = gepeto.targets.find((target) => target.path === conflictDir)

    assert.equal(conflict.status, "conflict")
    assert.match(await fs.readFile(path.resolve(conflictDir, "SKILL.md"), "utf8"), /custom-gepeto/)
    await assert.rejects(
      fs.stat(path.resolve(conflictDir, ManagedSkills.MARKER_FILENAME)),
      { code: "ENOENT" }
    )
  })
})

test("same-content legacy folders with extra files are not adopted or removed", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    await ManagedSkills.setSkillEnabled(kernel, "gepeto", false, { publishRoots })

    const sourceContent = await fs.readFile(ManagedSkills.skillPath(kernel, "gepeto"), "utf8")
    const legacyDir = path.resolve(publishRoots[0], "gepeto")
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(path.resolve(legacyDir, "SKILL.md"), sourceContent)
    await fs.writeFile(path.resolve(legacyDir, "USER_NOTES.md"), "keep this\n")

    const result = await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    const gepeto = result.results.find((entry) => entry.id === "gepeto")
    const conflict = gepeto.targets.find((target) => target.path === legacyDir)

    assert.equal(conflict.status, "conflict")
    assert.match(await fs.readFile(path.resolve(legacyDir, "USER_NOTES.md"), "utf8"), /keep this/)
    await assert.rejects(
      fs.stat(path.resolve(legacyDir, ManagedSkills.MARKER_FILENAME)),
      { code: "ENOENT" }
    )
  })
})

test("same-content legacy folders without extra files are adopted", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    await fs.rm(path.resolve(publishRoots[0], "gepeto"), { recursive: true, force: true })

    const sourceContent = await fs.readFile(ManagedSkills.skillPath(kernel, "gepeto"), "utf8")
    const legacyDir = path.resolve(publishRoots[0], "gepeto")
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(path.resolve(legacyDir, "SKILL.md"), sourceContent)

    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })

    const marker = await readJson(path.resolve(legacyDir, ManagedSkills.MARKER_FILENAME))
    assert.equal(marker.manager, "pinokio")
    assert.equal(marker.skillId, "gepeto")
  })
})

test("downloaded skill publish-name changes clean up old managed copies", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    kernel.exec = async ({ message }) => {
      const dir = cloneTargetFromMessage(message)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.resolve(dir, "SKILL.md"),
        "---\nname: Music Generation\ndescription: Make music.\n---\n\nUse the music tool.\n"
      )
    }
    await ManagedSkills.installSkillFromGit(kernel, {
      ref: "https://example.com/music-generation.git",
      publishRoots
    })

    await ManagedSkills.setSkillPublishName(kernel, "music-generation", "pinokio-music-alt", { publishRoots })

    for (const root of publishRoots) {
      await assert.rejects(
        fs.stat(path.resolve(root, "pinokio-music-generation")),
        { code: "ENOENT" }
      )
      assert.match(
        await fs.readFile(path.resolve(root, "pinokio-music-alt", "SKILL.md"), "utf8"),
        /name: Music Generation/
      )
    }
  })
})

test("downloaded valid skills publish with the pinokio prefix", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    kernel.exec = async ({ message }) => {
      const dir = cloneTargetFromMessage(message)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.resolve(dir, "SKILL.md"),
        "---\nname: Music Generation\ndescription: Make music.\n---\n\nUse the music tool.\n"
      )
    }

    const skill = await ManagedSkills.installSkillFromGit(kernel, {
      ref: "https://example.com/music-generation.git",
      publishRoots
    })

    assert.equal(skill.id, "music-generation")
    assert.equal(skill.enabled, true)
    assert.equal(skill.publishName, "pinokio-music-generation")

    for (const root of publishRoots) {
      assert.match(
        await fs.readFile(path.resolve(root, "pinokio-music-generation", "SKILL.md"), "utf8"),
        /name: Music Generation/
      )
    }
  })
})

test("downloaded invalid skills stay installed but disabled", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    kernel.exec = async ({ message }) => {
      const dir = cloneTargetFromMessage(message)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.resolve(dir, "README.md"), "No root skill document.\n")
    }

    const skill = await ManagedSkills.installSkillFromGit(kernel, {
      ref: "https://example.com/bad-skill.git",
      publishRoots
    })

    assert.equal(skill.id, "bad-skill")
    assert.equal(skill.enabled, false)
    assert.equal(skill.valid, false)
    assert.deepEqual(skill.errors, ["Missing SKILL.md at the skill root."])
    assert.equal(skill.publishName, "pinokio-bad-skill")
    await fs.stat(path.resolve(kernel.homedir, "skills", "bad-skill"))

    for (const root of publishRoots) {
      await assert.rejects(
        fs.stat(path.resolve(root, "pinokio-bad-skill")),
        { code: "ENOENT" }
      )
    }
  })
})

test("clone failure cleanup only removes the temporary clone directory", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    const finalDir = path.resolve(kernel.homedir, "skills", "race-skill")
    kernel.exec = async ({ message }) => {
      const tempDir = cloneTargetFromMessage(message)
      await fs.mkdir(tempDir, { recursive: true })
      await fs.mkdir(finalDir, { recursive: true })
      await fs.writeFile(path.resolve(finalDir, "KEEP.txt"), "do not remove\n")
      throw new Error("clone failed")
    }

    await assert.rejects(
      ManagedSkills.installSkillFromGit(kernel, {
        ref: "https://example.com/race-skill.git",
        publishRoots
      }),
      /clone failed/
    )

    assert.equal(await fs.readFile(path.resolve(finalDir, "KEEP.txt"), "utf8"), "do not remove\n")
  })
})

test("skill clone uses structured shell arguments for untrusted git refs", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    const maliciousRef = "https://example.com/evil-$(id).git"
    kernel.exec = async ({ message }) => {
      assert.equal(cloneRefFromMessage(message), maliciousRef)
      const dir = cloneTargetFromMessage(message)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.resolve(dir, "SKILL.md"),
        "---\nname: Suspicious Ref\ndescription: Test.\n---\n\nUse carefully.\n"
      )
    }

    const skill = await ManagedSkills.installSkillFromGit(kernel, {
      ref: maliciousRef,
      publishRoots
    })

    assert.equal(skill.id, "evil-id")
    assert.equal(skill.enabled, true)
  })
})

test("read-only skill lookup does not publish external copies", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    const skill = await ManagedSkills.getManagedSkill(kernel, "pinokio", { sync: false, publishRoots })

    assert.equal(skill.id, "pinokio")
    await assert.rejects(
      fs.stat(path.resolve(publishRoots[0], "pinokio")),
      { code: "ENOENT" }
    )
  })
})

test("no-op sync does not rewrite managed markers", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    const markerPath = path.resolve(publishRoots[0], "pinokio", ManagedSkills.MARKER_FILENAME)
    const first = await fs.readFile(markerPath, "utf8")

    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })

    assert.equal(await fs.readFile(markerPath, "utf8"), first)
  })
})

test("malformed index fails closed without republishing disabled skills", async () => {
  await withTempHome(async ({ kernel, publishRoots }) => {
    await ManagedSkills.syncManagedSkills(kernel, { publishRoots })
    await ManagedSkills.setSkillEnabled(kernel, "gepeto", false, { publishRoots })
    await fs.writeFile(ManagedSkills.indexPath(kernel), "{ invalid json\n")

    await assert.rejects(
      ManagedSkills.syncManagedSkills(kernel, { publishRoots }),
      /Failed to read managed skills index/
    )
    await assert.rejects(
      fs.stat(path.resolve(publishRoots[0], "gepeto")),
      { code: "ENOENT" }
    )
  })
})
