import asyncio
import unittest
import json
from unittest.mock import patch
import httpx

from app.ai_gateway import chat_with_provider, default_provider_id, public_provider_catalog, _bounded_context, _validated_endpoint, ProviderConfig, ProviderUnavailable
from app.config import Settings


class AIGatewayTests(unittest.TestCase):
    def test_long_context_is_still_valid_json(self):
        for value in ("x" * 10000, '"' * 10000, "\\" * 10000):
            result = _bounded_context({"image": value})
            self.assertTrue(json.loads(result)["truncated"])
            self.assertLessEqual(len(result), 6000)

    def test_endpoint_rejects_embedded_credentials_and_query(self):
        for url in ("https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "file:///tmp/model"):
            with self.subTest(url=url), self.assertRaises(ProviderUnavailable):
                _validated_endpoint(ProviderConfig("custom", "custom", url, "key", "model"))
        self.assertEqual(_validated_endpoint(ProviderConfig("custom", "custom", "https://example.com/v1/", "key", "model")), "https://example.com/v1/chat/completions")

    def test_live_gateway_reports_safe_actionable_errors(self):
        for status, text in ((401, "权限"), (429, "频率"), (503, "服务异常")):
            async def handler(request):
                return httpx.Response(status, json={"error": "secret-upstream-message"}, request=request)
            original = httpx.AsyncClient
            transport = httpx.MockTransport(handler)
            with self.subTest(status=status), patch("app.ai_gateway.httpx.AsyncClient", side_effect=lambda **kwargs: original(transport=transport, **kwargs)):
                with self.assertRaises(ProviderUnavailable) as caught:
                    asyncio.run(chat_with_provider(Settings(_env_file=None, deepseek_api_key="secret-key"), "deepseek", "复核", {}, []))
                self.assertIn(text, str(caught.exception))
                self.assertNotIn("secret", str(caught.exception))

    def test_live_gateway_preserves_sources_and_answer(self):
        async def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body["messages"][-1]["role"], "user")
            return httpx.Response(200, json={"choices": [{"message": {"content": " 请人工复核 "}}], "usage": {"total_tokens": 12}})
        original = httpx.AsyncClient
        with patch("app.ai_gateway.httpx.AsyncClient", side_effect=lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)):
            result = asyncio.run(chat_with_provider(Settings(_env_file=None, deepseek_api_key="test-key"), "deepseek", "复核", {}, []))
        self.assertEqual(result["mode"], "live")
        self.assertEqual(result["answer"], "请人工复核")
        self.assertEqual(result["usage"]["total_tokens"], 12)

    def test_timeout_has_recovery_message(self):
        async def handler(request):
            raise httpx.ReadTimeout("private-upstream-detail", request=request)
        original = httpx.AsyncClient
        with patch("app.ai_gateway.httpx.AsyncClient", side_effect=lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)):
            with self.assertRaises(ProviderUnavailable) as caught:
                asyncio.run(chat_with_provider(Settings(_env_file=None, deepseek_api_key="key"), "deepseek", "复核", {}, []))
        self.assertIn("响应超时", str(caught.exception))
        self.assertNotIn("private", str(caught.exception))

    def test_demo_is_available_without_keys(self):
        settings = Settings(_env_file=None)
        providers = public_provider_catalog(settings)
        demo = next(provider for provider in providers if provider["id"] == "demo")
        self.assertTrue(demo["configured"])
        self.assertEqual(default_provider_id(settings), "demo")

    def test_configured_provider_becomes_default(self):
        settings = Settings(_env_file=None, ai_default_provider="deepseek", deepseek_api_key="test-key")
        self.assertEqual(default_provider_id(settings), "deepseek")

    def test_demo_chat_is_context_aware_and_explicit(self):
        settings = Settings(_env_file=None)
        result = asyncio.run(chat_with_provider(settings, "demo", "这个热斑怎么复核？", {"module": "双模态证据"}, []))
        self.assertEqual(result["mode"], "demo")
        self.assertIn("双模态证据", result["answer"])
        self.assertIn("工程故障", result["answer"])

    def test_demo_chat_uses_evidence_metrics_for_risk_question(self):
        settings = Settings(_env_file=None)
        context = {
            "module": "双模态证据",
            "evidence": {
                "eventId": "EVT-240905-018",
                "defectCandidate": "组件热斑",
                "temperatureDeltaC": 18.6,
                "alignmentQuality": 0.97,
                "registrationErrorPx": 1.7,
                "crossFramePersistence": {"frames": 6, "seconds": 4.2},
            },
        }
        result = asyncio.run(chat_with_provider(settings, "demo", "解释当前风险", context, []))
        self.assertIn("EVT-240905-018", result["answer"])
        self.assertIn("18.6", result["answer"])
        self.assertIn("1.7", result["answer"])
        self.assertIn("连续存在 6 帧", result["answer"])


if __name__ == "__main__":
    unittest.main()
