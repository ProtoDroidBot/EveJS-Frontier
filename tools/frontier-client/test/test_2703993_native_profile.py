from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import frontier_windows_client as windows
import verify_2703993_native as verification


class Native2703993ProfileTests(unittest.TestCase):
    def test_exact_profile_is_registered_separately(self):
        path, profile = windows.resolve_profile(2703993, "blue.pyd")
        self.assertEqual(path.name, "blue-pyd.2703993.patch.json")
        self.assertEqual(profile["source"]["sha256"], "bbb482acbd968513107b3755e08e8bb54796d1d498e62034c64e841a17f1aa81")
        self.assertEqual(profile["target"]["sha256"], "3813f926df48ac4de69a71771678a57f77fdeb1ec0cc2237ac267ea827c22bc3")
        _, other = windows.resolve_profile(3640684, "blue.pyd")
        self.assertNotEqual(profile["source"]["sha256"], other["source"]["sha256"])
        self.assertNotEqual(profile["patches"][0]["fileOffset"], other["patches"][0]["fileOffset"])
        with self.assertRaisesRegex(windows.FrontierWindowsError, "does not match staged build"):
            windows.resolve_profile(3640684, "blue.pyd", path)

    @unittest.skipUnless(os.environ.get("EVEJS_FRONTIER_2703993_CLIENT_ROOT"), "Set EVEJS_FRONTIER_2703993_CLIENT_ROOT for exact-input offline verification.")
    def test_real_input_control_flow_and_copy_patch_check_restore(self):
        result = verification.verify(Path(os.environ["EVEJS_FRONTIER_2703993_CLIENT_ROOT"]))
        for field in ["copiedPairPatchCheckRestore", "idempotent", "tamperedSourceAndTargetRejected",
                      "partialPatchRejected", "sourceInputsUnchanged", "sourceManifestTargetsMatch"]:
            self.assertIs(result[field], True, field)
        self.assertEqual(result["controlFlow"]["instructionReferencesVerified"], 10)
        self.assertEqual(result["controlFlow"]["functionBoundsAndHashesVerified"], 2)
        self.assertIs(result["sourceAuthenticodeTrustValidated"], False)
        self.assertIs(result["fullClientStageValidated"], False)
        self.assertIs(result["nativeLaunchValidated"], False)


if __name__ == "__main__":
    unittest.main()
