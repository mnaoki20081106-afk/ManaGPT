import unittest
from sidecar import validate_url

class ValidationTests(unittest.TestCase):
    def test_valid_v3(self):
        host = "a" * 56 + ".onion"
        self.assertEqual(validate_url("http://" + host + "/article"), "http://" + host + "/article")

    def test_invalid_urls(self):
        host = "a" * 56 + ".onion"
        for url in ["https://example.org", "http://localhost", "http://abc.onion",
                    "file:///etc/passwd", "http://user:pass@" + host,
                    "http://" + host + ":8080", "http://" + host + "/#frag"]:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    validate_url(url)

if __name__ == "__main__":
    unittest.main()
