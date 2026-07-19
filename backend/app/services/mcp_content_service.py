import asyncio
from typing import Any, Dict, List, Optional
from ..schemas.domain_schemas import Article, PublicationBlock

class MCPError(Exception):
    """Base exception for MCP Content Service."""
    pass

class MCPConnectionError(MCPError):
    """Raised when connection to MCP server fails."""
    pass

class MCPTimeoutError(MCPError):
    """Raised when an MCP tool invocation times out."""
    pass

class ContentNotFoundError(MCPError):
    """Raised when the requested content is not found."""
    pass

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import json

class MCPContentService:
    def __init__(self, server_command: str = "advenimus-jw-mcp", server_args: List[str] = None, timeout_seconds: int = 10):
        self.server_command = server_command
        self.server_args = server_args or []
        self.timeout_seconds = timeout_seconds
        self._session: Optional[ClientSession] = None
        self._connected = False

    async def connect(self):
        """Connect to the MCP server using stdio."""
        if self._connected:
            return True

        try:
            server_params = StdioServerParameters(
                command=self.server_command,
                args=self.server_args
            )

            # Using context managers manually here for persistent connection in service lifespan
            # In a true application lifecycle, we'd manage this with lifespan context
            from contextlib import AsyncExitStack
            self._exit_stack = AsyncExitStack()

            stdio_transport = await self._exit_stack.enter_async_context(stdio_client(server_params))
            read_stream, write_stream = stdio_transport

            self._session = await self._exit_stack.enter_async_context(ClientSession(read_stream, write_stream))

            await self._session.initialize()
            self._connected = True
            return True
        except Exception as e:
            raise MCPConnectionError(f"Failed to connect to MCP server: {str(e)}")

    async def disconnect(self):
        """Disconnect from the MCP server."""
        if self._connected and hasattr(self, '_exit_stack'):
            await self._exit_stack.aclose()
            self._connected = False
            self._session = None

    async def _call_mcp_tool(self, tool_name: str, parameters: Dict[str, Any]) -> Any:
        """
        Invoke an MCP tool over the active session.
        """
        if not self._connected or not self._session:
            raise MCPConnectionError("Not connected to MCP server.")

        try:
            result = await self._session.call_tool(tool_name, arguments=parameters)

            # Usually MCP tools return content list. We assume JSON is returned in the text of the first content item.
            if result and hasattr(result, 'content') and len(result.content) > 0:
                content_text = result.content[0].text
                try:
                    return json.loads(content_text)
                except json.JSONDecodeError:
                    return content_text
            return None
        except Exception as e:
            if "Timeout" in str(e):
                raise MCPTimeoutError(f"Timeout calling tool {tool_name}")
            raise MCPError(f"Error calling MCP tool {tool_name}: {str(e)}")

    async def search_publication(self, query: str) -> List[Dict[str, Any]]:
        """
        Tool: Search for publications.
        Returns the raw parsed response from the MCP tool.
        """
        try:
            return await asyncio.wait_for(
                self._call_mcp_tool("search_publication", {"query": query}),
                timeout=self.timeout_seconds
            )
        except asyncio.TimeoutError:
            raise MCPTimeoutError(f"Timeout searching publication for query: {query}")
        except Exception as e:
            if isinstance(e, MCPError):
                raise
            raise MCPConnectionError(f"Error calling MCP tool: {str(e)}")

    async def get_jw_captions(self, video_id: str) -> List[Dict[str, Any]]:
        """
        Tool: Get subtitles for a video.
        """
        try:
            return await asyncio.wait_for(
                self._call_mcp_tool("get_jw_captions", {"video_id": video_id}),
                timeout=self.timeout_seconds
            )
        except asyncio.TimeoutError:
            raise MCPTimeoutError(f"Timeout getting captions for video_id: {video_id}")
        except Exception as e:
            if isinstance(e, MCPError):
                raise
            raise MCPConnectionError(f"Error calling MCP tool: {str(e)}")

    async def get_article_content(self, document_id: int) -> Article:
        """
        Tool: Get the content of an article.
        Uses Adapter pattern to transform MCP raw response into `Article` model.
        """
        try:
            raw_response = await asyncio.wait_for(
                self._call_mcp_tool("get_article_content", {"document_id": document_id}),
                timeout=self.timeout_seconds
            )
        except asyncio.TimeoutError:
            raise MCPTimeoutError(f"Timeout getting article content for document_id: {document_id}")
        except Exception as e:
            if isinstance(e, MCPError):
                raise
            raise MCPConnectionError(f"Error calling MCP tool: {str(e)}")

        if not raw_response:
            raise ContentNotFoundError(f"Article with document_id {document_id} not found.")

        return self._adapt_article(document_id, raw_response)

    def _adapt_article(self, document_id: int, raw_data: Dict[str, Any]) -> Article:
        """
        Adapter: Converts raw MCP JSON dict into the uniform internal Article model.
        Expects raw_data to have 'title' and a list of 'elements' which can be chapters, paragraphs, images, etc.
        """
        title = raw_data.get("title", "Unknown Title")
        raw_elements = raw_data.get("elements", [])

        blocks: List[PublicationBlock] = []

        for index, elem in enumerate(raw_elements):
            # Normalizing block types
            elem_type = elem.get("type", "paragraph").lower()
            content = ""

            # Simple content extraction logic based on expected raw formats
            if elem_type in ["paragraph", "chapter", "title", "reference"]:
                content = elem.get("text", "")
            elif elem_type == "image":
                url = elem.get("url", "")
                alt = elem.get("alt", "")
                content = f"![{alt}]({url})"
            else:
                content = str(elem.get("content", ""))

            blocks.append(
                PublicationBlock(
                    blockId=elem.get("id", index + 1),
                    blockType=elem_type,
                    content=content
                )
            )

        return Article(
            documentId=document_id,
            title=title,
            blocks=blocks
        )
